import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import {
	PageRecordType,
	createShapeId,
	getIndexAbove,
	toRichText,
} from "tldraw"
import type { SerializedSchema, TLRecord, TLShape } from "tldraw"
import {
	checkBoardFile,
	createBoardStore,
	createBoardSync,
} from "../src/client/whiteboard-store"
import { legacyRecords } from "../src/client/whiteboard-legacy"
import { Replica } from "../src/shared/crdt"
import {
	archiveContents,
	archiveIdentityKeys,
	documentKey,
	exportArchive,
	importSteps,
	importedSource,
	parseArchive,
} from "../src/shared/document-archive"
import { newDocument } from "../src/shared/documents"
import type { ZipEntry } from "../src/shared/zip"
import {
	boardFile,
	boardFileFields,
	boardRecords,
	boardSchemas,
	isTldrawBoard,
	parseTldrawFile,
	recordField,
	schemaField,
	schemaKey,
	storedRecord,
	storedValue,
	writeBatches,
} from "../src/shared/whiteboard"

function register(initial: Record<string, string> = {}) {
	let fields: Record<string, string> = { type: "whiteboard", ...initial }
	return {
		fields: () => ({ ...fields }),
		write(values: ReadonlyArray<[string, string]>) {
			for (let [field, value] of values) fields[field] = value
		},
	}
}

function peer(board: ReturnType<typeof register>) {
	let errors: unknown[] = []
	let store = createBoardStore()
	let sync = createBoardSync(store, board.fields, error => errors.push(error))
	return {
		store,
		sync,
		errors,
		flush() {
			let values = sync.take()
			board.write(values)
			sync.settle(values)
			return values
		},
	}
}

function geo(id: string, x: number, text = ""): TLShape {
	return {
		id: createShapeId(id),
		typeName: "shape",
		type: "geo",
		parentId: PageRecordType.createId("page"),
		index: getIndexAbove(),
		x,
		y: 0,
		rotation: 0,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {
			geo: "rectangle",
			dash: "draw",
			url: "",
			w: 100,
			h: 50,
			growY: 0,
			scale: 1,
			labelColor: "black",
			color: "black",
			fill: "none",
			size: "m",
			font: "draw",
			align: "middle",
			verticalAlign: "middle",
			richText: toRichText(text),
		},
	}
}

function shapes(store: ReturnType<typeof createBoardStore>) {
	return store.allRecords().filter(record => record.typeName === "shape")
}

test("each tldraw record is stored in its own register field naming its schema", () => {
	let board = register()
	let writer = peer(board)
	writer.store.put([geo("a", 10)])
	let values = writer.flush()
	let fields = board.fields()
	let schema = JSON.stringify(writer.store.schema.serialize())
	expect(values.map(([field]) => field).sort()).toEqual([
		"record:document:document",
		"record:page:page",
		"record:shape:a",
		schemaField(schemaKey(schema)),
	])
	expect(values[0]).toEqual([schemaField(schemaKey(schema)), schema])
	expect(storedRecord("shape:a", fields["record:shape:a"] ?? "")).toMatchObject(
		{
			schema: schemaKey(schema),
			record: { type: "geo", x: 10 },
		},
	)
	expect(isTldrawBoard(fields)).toBe(true)
	expect(writer.sync.take()).toEqual([])
	expect(writer.errors).toEqual([])
})

test("deleting a record leaves an empty tombstone and peers follow without echo", () => {
	let board = register()
	let writer = peer(board)
	writer.store.put([geo("a", 10), geo("b", 200)])
	writer.flush()
	let reader = peer(board)
	expect(shapes(reader.store)).toHaveLength(2)
	expect(reader.sync.take()).toEqual([])

	writer.store.remove([createShapeId("a")])
	writer.store.update(createShapeId("b"), shape => ({ ...shape, x: 300 }))
	writer.flush()
	expect(board.fields()["record:shape:a"]).toBe("")
	reader.sync.pull()
	expect(
		shapes(reader.store).map(shape => [String(shape.id), shape.x]),
	).toEqual([["shape:b", 300]])
	expect(reader.sync.take()).toEqual([])
	expect(reader.sync.pending()).toBe(false)
})

test("local edits in flight win over stale register reads until they settle", () => {
	let board = register()
	let writer = peer(board)
	writer.store.put([geo("a", 10)])
	let values = writer.sync.take()
	writer.sync.pull()
	expect(writer.store.get(createShapeId("a"))?.x).toBe(10)
	writer.store.update(createShapeId("a"), shape => ({ ...shape, x: 20 }))
	board.write(values)
	writer.sync.settle(values)
	expect(writer.store.get(createShapeId("a"))?.x).toBe(20)
	let next = writer.sync.take()
	expect(next.map(([field]) => field)).toEqual(["record:shape:a"])
})

test("a failed write keeps its records for the next attempt", () => {
	let board = register()
	let writer = peer(board)
	writer.store.put([geo("a", 10)])
	let values = writer.sync.take()
	writer.sync.restore(values)
	expect(writer.sync.pending()).toBe(true)
	expect(writer.sync.take().map(([field]) => field)).toContain("record:shape:a")
})

test("register undo replays as a remote change and removes the shape", () => {
	let board = register()
	let writer = peer(board)
	writer.flush()
	let before = board.fields()
	writer.store.put([geo("a", 10)])
	writer.flush()
	board.write([["record:shape:a", before["record:shape:a"] ?? ""]])
	writer.sync.pull()
	expect(shapes(writer.store)).toHaveLength(0)
	expect(writer.sync.take()).toEqual([])
})

test("legacy drawings convert to valid records and migrate with the first edit", () => {
	let legacy = {
		"shape:box": JSON.stringify({
			kind: "rectangle",
			color: "#e03131",
			width: 4,
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 60 },
			],
			text: "Box",
			fill: "#e03131",
			order: "1",
		}),
		"shape:ink": JSON.stringify({
			kind: "pen",
			color: "#4465e9",
			width: 2,
			points: "10,10 20,25 30,15",
			text: "",
			pressure: [0.2, 0.6, 0.4],
			order: "2",
		}),
		"shape:arrow": JSON.stringify({
			kind: "arrow",
			color: "#1d1d1d",
			width: 4,
			points: [
				{ x: 200, y: 30 },
				{ x: 110, y: 30 },
			],
			text: "",
			end: { shape: "shape:box", x: 1, y: 0.5 },
			order: "3",
		}),
		"shape:line": JSON.stringify({
			kind: "line",
			color: "#9fa8b2",
			width: 8,
			points: [
				{ x: 0, y: 200 },
				{ x: 50, y: 220 },
				{ x: 90, y: 200 },
			],
			text: "",
			dash: "dashed",
			order: "4",
			group: "pair",
		}),
		"shape:note": JSON.stringify({
			kind: "text",
			color: "#099268",
			width: 4,
			points: [{ x: 0, y: 300 }],
			text: "Hello\nworld",
			rotation: 0.5,
			order: "5",
			group: "pair",
		}),
		"stroke:broken": "{not json",
	}
	expect(legacyRecords(legacy)).toEqual(legacyRecords(legacy))
	let board = register(legacy)
	let writer = peer(board)
	expect(writer.errors).toEqual([])
	let records = new Map(
		writer.store.allRecords().map(record => [record.id, record]),
	)
	expect(records.get(createShapeId("legacy-shape-box"))).toMatchObject({
		type: "geo",
		props: { color: "red", fill: "solid", w: 100, h: 60 },
	})
	expect(records.get(createShapeId("legacy-shape-ink"))).toMatchObject({
		type: "draw",
		props: { isPen: true, color: "blue" },
	})
	expect(records.get(createShapeId("legacy-shape-line"))).toMatchObject({
		type: "line",
		parentId: "shape:legacy-group-pair",
		props: { dash: "dashed" },
	})
	expect(records.get(createShapeId("legacy-shape-note"))).toMatchObject({
		type: "text",
		rotation: 0.5,
	})
	expect(
		writer.store
			.allRecords()
			.filter(record => record.typeName === "binding")
			.map(binding => [String(binding.fromId), String(binding.toId)]),
	).toEqual([["shape:legacy-shape-arrow", "shape:legacy-shape-box"]])
	expect(writer.sync.take()).toEqual([])

	writer.store.update(createShapeId("legacy-shape-box"), shape => ({
		...shape,
		x: 5,
	}))
	writer.flush()
	let fields = board.fields()
	expect(fields["shape:box"]).toBe("")
	expect(fields["shape:ink"]).toBe("")
	expect(boardRecords(fields).size).toBe(
		writer.store
			.allRecords()
			.filter(record =>
				["document", "page", "shape", "binding"].includes(record.typeName),
			).length,
	)
	let reader = peer(board)
	expect(shapes(reader.store)).toHaveLength(shapes(writer.store).length)
	expect(reader.sync.take()).toEqual([])
})

test(".tldr files round-trip losslessly and reject media and extra pages", () => {
	let board = register()
	let writer = peer(board)
	writer.store.put([geo("a", 10, "Label")])
	writer.flush()
	let fields = board.fields()
	let source = boardFile(fields) ?? ""
	let file = parseTldrawFile(JSON.parse(source))
	expect(file.records).toEqual(boardRecords(fields))
	let copy = register()
	copy.write(boardFileFields(copy.fields(), file))
	expect(boardFile(copy.fields())).toBe(source)
	let reader = peer(copy)
	expect(reader.store.get(createShapeId("a"))).toEqual(
		writer.store.get(createShapeId("a")),
	)

	let parsed = JSON.parse(source)
	expect(() =>
		parseTldrawFile({
			...parsed,
			records: [...parsed.records, { id: "page:two", typeName: "page" }],
		}),
	).toThrow("one page")
	expect(() =>
		parseTldrawFile({
			...parsed,
			records: [...parsed.records, { id: "asset:x", typeName: "asset" }],
		}),
	).toThrow("Embedded media")
	expect(() =>
		parseTldrawFile({
			...parsed,
			records: [
				...parsed.records,
				{ id: "shape:v", typeName: "shape", type: "video" },
			],
		}),
	).toThrow("Embedded media")
	expect(
		parseTldrawFile({
			format: "alkalye-tldraw-v1",
			snapshot: source,
		}).records.size,
	).toBe(3)

	let replaced = register(fields)
	replaced.write(
		boardFileFields(replaced.fields(), {
			schemas: file.schemas,
			records: new Map(
				[...file.records].filter(([id]) => !id.startsWith("shape:")),
			),
		}),
	)
	expect(replaced.fields()[recordField("shape:a")]).toBe("")
})

test("register writes split into actions within the server limits", () => {
	let values: [string, string][] = [
		["schema:a", "{}"],
		["preview", "x".repeat(1000)],
		...Array.from({ length: 2000 }, (_, index): [string, string] => [
			"record:shape:" + index,
			"y".repeat(150),
		]),
	]
	let batches = writeBatches(values)
	expect(batches.length).toBeGreaterThan(2)
	for (let batch of batches) {
		expect(batch.length).toBeLessThanOrEqual(900)
		expect(
			batch.reduce((total, [, value]) => total + value.length, 0),
		).toBeLessThanOrEqual(180_000)
	}
	expect(batches.flat()).toHaveLength(values.length)
	expect(batches.at(-1)?.map(([field]) => field)).toContain("preview")
	expect(batches[0]?.[0]).toEqual(["schema:a", "{}"])

	let replaced = Object.fromEntries(
		Array.from({ length: 10 }, (_, index) => [
			"record:shape:" + index,
			"z".repeat(50_000),
		]),
	)
	let removals = Array.from({ length: 10 }, (_, index): [string, string] => [
		"record:shape:" + index,
		"",
	])
	let bounded = writeBatches(removals, replaced)
	expect(bounded.length).toBeGreaterThan(2)
	for (let batch of bounded)
		expect(
			batch.reduce(
				(total, [field]) => total + (replaced[field] ?? "").length,
				0,
			),
		).toBeLessThanOrEqual(180_000)
})

test("backups carry boards as .tldr files and restore the same records", async () => {
	let board = register()
	let writer = peer(board)
	writer.store.put([geo("a", 10, "Kept"), geo("b", 200)])
	writer.flush()
	let replica = new Replica("author")
	newDocument(replica, "doc", "Untitled", "# Plan\n\n![Plan](asset:board)\n")
	for (let [field, value] of Object.entries({
		...board.fields(),
		document: "doc",
		name: "Plan",
		preview: "<svg/>",
	}))
		replica.set("board", field, value)
	let entries = await Effect.runPromise(
		exportArchive([
			{
				document: "doc",
				replica,
				media: new Map([["board", new TextEncoder().encode("<svg/>")]]),
			},
		]),
	)
	let sidecar = entries.find(entry => entry.name.endsWith(".svg.tldr"))
	expect(new TextDecoder().decode(sidecar?.data)).toBe(
		boardFile(replica.fields("board")) ?? "",
	)

	let restored = await restore(entries)
	let [restoredBoard] = archiveContents(
		restored.replica,
		restored.id,
	).whiteboards
	let fields = restored.replica.fields(restoredBoard ?? "")
	expect(fields.type).toBe("whiteboard")
	expect(boardRecords(fields)).toEqual(boardRecords(replica.fields("board")))
	expect(boardSchemas(fields)).toEqual(boardSchemas(replica.fields("board")))
	expect(fields.preview ?? "").toBe("")

	let loose = await restore([
		{
			name: "Sketch/Sketch.md",
			data: new TextEncoder().encode(
				"# Sketch\n\n![Sketch](assets/Sketch.svg)\n",
			),
		},
		{
			name: "Sketch/assets/Sketch.svg",
			data: new TextEncoder().encode("<svg/>"),
		},
		{
			name: "Sketch/assets/Sketch.svg.tldr",
			data: new TextEncoder().encode(boardFile(board.fields()) ?? ""),
		},
	])
	let [looseBoard] = archiveContents(loose.replica, loose.id).whiteboards
	expect(boardRecords(loose.replica.fields(looseBoard ?? ""))).toEqual(
		boardRecords(board.fields()),
	)
})

// The schema before tldraw stored labels as rich text: these records cannot
// be read as the current schema without migrating them.
function olderBoard(count: number) {
	let source = createBoardStore()
	let current = source.schema.serialize()
	let older: SerializedSchema = {
		...current,
		sequences: { ...current.sequences, "com.tldraw.shape.geo": 9 },
	}
	let schema = JSON.stringify(older)
	let key = schemaKey(schema)
	let fields: Record<string, string> = { [schemaField(key)]: schema }
	source.put(
		Array.from({ length: count }, (_, index) =>
			geo("s" + index, index, "Label " + index),
		),
	)
	// tldraw has no down migration from rich text, so labels are written the
	// way geo shapes stored them before it.
	for (let record of source.allRecords()) {
		if (!["document", "page", "shape"].includes(record.typeName)) continue
		let value =
			record.typeName === "shape" && record.type === "geo"
				? (({ richText: _richText, ...props }) => ({
						...record,
						props: { ...props, text: "Label " + record.x },
					}))(record.props)
				: record
		fields[recordField(record.id)] = storedValue(key, value)
	}
	return { fields, key }
}

function labels(store: ReturnType<typeof createBoardStore>) {
	return shapes(store)
		.map(shape =>
			shape.type === "geo"
				? JSON.stringify(shape.props.richText).match(/Label \d+/)?.[0]
				: undefined,
		)
		.sort()
}

test("an older board rewritten in several actions reads correctly when only the first lands", () => {
	let { fields: initial, key } = olderBoard(1000)
	expect(
		JSON.parse(initial[recordField("shape:s1")] ?? "").record.props.text,
	).toBe("Label 1")
	let board = register(initial)
	let writer = peer(board)
	expect(writer.errors).toEqual([])
	expect(shapes(writer.store)).toHaveLength(1000)
	let expected = labels(writer.store)
	expect(expected[0]).toBe("Label 0")
	expect(writer.sync.take()).toEqual([])

	writer.store.update(createShapeId("s1"), shape => ({ ...shape, x: 999 }))
	let values = writer.sync.take()
	let batches = writeBatches(values, board.fields())
	expect(batches.length).toBeGreaterThan(1)
	let [first = [], ...rest] = batches
	board.write(first)
	writer.sync.settle(first)
	writer.sync.restore(rest.flat())

	let keys = new Set(
		[...boardRecords(board.fields())].map(
			([id, value]) => storedRecord(id, value)?.schema,
		),
	)
	expect(keys.size).toBe(2)
	expect(keys.has(key)).toBe(true)
	let reopened = peer(board)
	expect(reopened.errors).toEqual([])
	expect(labels(reopened.store)).toEqual(expected)
	expect(reopened.store.get(createShapeId("s1"))?.x).toBe(999)
	expect(reopened.sync.take()).toEqual([])

	let mixed = parseTldrawFile(JSON.parse(boardFile(board.fields()) ?? ""))
	expect(mixed.schemas.size).toBe(2)
	let copy = register()
	copy.write(boardFileFields(copy.fields(), mixed))
	expect(labels(peer(copy).store)).toEqual(expected)

	while (writer.sync.pending()) writer.flush()
	expect(
		new Set(
			[...boardRecords(board.fields())].map(
				([id, value]) => storedRecord(id, value)?.schema,
			),
		).size,
	).toBe(1)
	let finished = peer(board)
	expect(finished.errors).toEqual([])
	expect(labels(finished.store)).toEqual(expected)
})

test("a board saved by a newer schema is shown but never written", () => {
	let board = register()
	let writer = peer(board)
	writer.store.put([geo("a", 10)])
	writer.flush()
	let fields = board.fields()
	let current = writer.store.schema.serialize()
	let newer = JSON.stringify({
		...current,
		sequences: { ...current.sequences, "com.tldraw.shape.future": 1 },
	})
	let key = schemaKey(newer)
	let stored = storedRecord("shape:a", fields[recordField("shape:a")] ?? "")
	board.write([
		[schemaField(key), newer],
		[recordField("shape:a"), storedValue(key, stored?.record)],
	])
	let reader = peer(board)
	expect(reader.sync.newer()).toBe(true)
	reader.store.update(createShapeId("a"), shape => ({ ...shape, x: 50 }))
	expect(reader.sync.take()).toEqual([])
})

test("a legacy conversion cut short neither duplicates nor revives shapes", () => {
	let legacy = Object.fromEntries(
		Array.from({ length: 950 }, (_, index) => [
			"shape:" + index,
			JSON.stringify({
				kind: "rectangle",
				color: "#e03131",
				width: 4,
				points: [
					{ x: index, y: 0 },
					{ x: index + 20, y: 20 },
				],
				text: "",
				order: String(index).padStart(4, "0"),
			}),
		]),
	)
	let board = register(legacy)
	let writer = peer(board)
	expect(shapes(writer.store)).toHaveLength(950)
	writer.store.remove([createShapeId("legacy-shape-3")])
	let values = writer.sync.take()
	let batches = writeBatches(values, board.fields())
	expect(batches.length).toBeGreaterThan(1)
	let first = batches[0] ?? []
	expect(
		first.some(([field]) => field === recordField("shape:legacy-shape-3")),
	).toBe(true)
	board.write(first)
	writer.sync.settle(first)
	writer.sync.restore(batches.slice(1).flat())
	expect(board.fields()["shape:3"]).not.toBe("")
	let reopened = peer(board)
	expect(reopened.errors).toEqual([])
	expect(shapes(reopened.store)).toHaveLength(949)
	expect(reopened.store.get(createShapeId("legacy-shape-3"))).toBeUndefined()
	while (writer.sync.pending()) writer.flush()
	expect(
		Object.keys(board.fields()).filter(
			key => key.startsWith("shape:") && board.fields()[key],
		),
	).toEqual([])
	expect(shapes(peer(board).store)).toHaveLength(949)
})

test(".tldr imports reject duplicate records and dangling references", () => {
	let board = register()
	let writer = peer(board)
	writer.store.put([geo("a", 10)])
	writer.flush()
	let parsed = JSON.parse(boardFile(board.fields()) ?? "")
	let shape = parsed.records.find(
		(record: TLRecord) => record.typeName === "shape",
	)
	expect(() =>
		parseTldrawFile({
			...parsed,
			records: [...parsed.records, { ...shape, x: 5 }],
		}),
	).toThrow("twice")
	expect(() =>
		parseTldrawFile({
			...parsed,
			records: [
				...parsed.records,
				{ ...shape, id: "shape:b", parentId: "page:gone" },
			],
		}),
	).toThrow("missing")
	expect(() =>
		parseTldrawFile({
			...parsed,
			records: [
				...parsed.records,
				{
					id: "binding:x",
					typeName: "binding",
					fromId: "shape:a",
					toId: "shape:gone",
				},
			],
		}),
	).toThrow("missing")
	expect(() =>
		parseTldrawFile({
			...parsed,
			records: parsed.records.map((record: TLRecord) =>
				record.typeName === "document"
					? { ...record, id: "document:other" }
					: record,
			),
		}),
	).toThrow("identity")
	checkBoardFile(parseTldrawFile(parsed))
	expect(() =>
		checkBoardFile(
			parseTldrawFile({
				...parsed,
				records: parsed.records.map((record: TLRecord) =>
					record.typeName === "shape"
						? { ...record, props: { geo: "nonsense" } }
						: record,
				),
			}),
		),
	).toThrow("could not be read")
})

test("malformed and mismatched register values only lose themselves", () => {
	let board = register()
	let writer = peer(board)
	writer.store.put([geo("a", 10), geo("b", 20)])
	writer.flush()
	let fields = board.fields()
	board.write([
		[recordField("shape:a"), "{not json"],
		[
			recordField("shape:b"),
			fields[recordField("shape:b")]?.replace("shape:b", "shape:c") ?? "",
		],
		[
			recordField("shape:d"),
			'{"schema":"missing","record":{"id":"shape:d","typeName":"shape"}}',
		],
	])
	let reader = peer(board)
	expect(shapes(reader.store)).toEqual([])
	expect(reader.errors).toHaveLength(1)
	expect(reader.store.query.records("page").get()).toHaveLength(1)
})

async function restore(entries: ReadonlyArray<ZipEntry>) {
	let plan = await Effect.runPromise(parseArchive(entries))
	let identities = new Map(
		archiveIdentityKeys(plan).map((key, index) => [key, "restored-" + index]),
	)
	let document = plan.documents[0]
	if (!document) throw new Error("Missing document")
	let id = identities.get(documentKey(document)) ?? ""
	let replica = new Replica("restorer")
	let { source } = await Effect.runPromise(
		importedSource(plan, document, identities),
	)
	newDocument(replica, id, "Untitled", source)
	for (let step of await Effect.runPromise(
		importSteps(plan, document, identities, new Map()),
	))
		step.build(replica)
	return { replica, id }
}
