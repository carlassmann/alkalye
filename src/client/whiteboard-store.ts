import {
	DocumentRecordType,
	PageRecordType,
	TLDOCUMENT_ID,
	createTLStore,
	getIndexAbove,
	parseTldrawJsonFile,
} from "tldraw"
import type { TLRecord, TLSchema, TLStore } from "tldraw"
import type { TldrawFile } from "../shared/whiteboard"
import { object } from "../shared/model"
import {
	boardRecords,
	boardSchemas,
	compareSchema,
	deletedRecords,
	documentRecord,
	documentTypes,
	hasLegacyDrawing,
	legacyTombstones,
	recordField,
	recordPrefix,
	schemaField,
	schemaKey,
	storedRecord,
	storedValue,
} from "../shared/whiteboard"
import { legacyRecords } from "./whiteboard-legacy"

// Keeps a tldraw store and a whiteboard register in step. Edits a person makes
// in tldraw are collected by record and written as register fields; register
// changes from peers, undo and redo are merged back as remote changes, and
// whatever tldraw derives from them is not written back, so nothing echoes.
export interface BoardSync {
	readonly store: TLStore
	// Applies the register to the store; local edits not yet written win.
	pull(): void
	// Takes the local edits that differ from the register. They count as in
	// flight until `settle` or `restore`.
	take(): [string, string][]
	settle(values: ReadonlyArray<[string, string]>): void
	restore(values: ReadonlyArray<[string, string]>): void
	pending(): boolean
	// The records not yet written, for keeping them past a failed close.
	unsaved(): TLRecord[]
	// A board saved by a newer version is shown but never written.
	newer(): boolean
	// Drops edits that can no longer be written, such as after losing write
	// access, and shows the register again.
	discard(): void
	dispose(): void
}

// The document and page tldraw needs exist from the start, so mounting an
// editor on the store adds nothing a board would have to write.
export function createBoardStore() {
	let store = createTLStore()
	store.put([
		DocumentRecordType.create({ id: TLDOCUMENT_ID }),
		PageRecordType.create({
			id: PageRecordType.createId("page"),
			name: "Page 1",
			index: getIndexAbove(),
		}),
	])
	return store
}

export function currentSchema(store: TLStore) {
	return JSON.stringify(store.schema.serialize())
}

export function createBoardSync(
	store: TLStore,
	fields: () => Record<string, string>,
	failed: (error: unknown) => void,
): BoardSync {
	let schema = currentSchema(store)
	let key = schemaKey(schema)
	let known = new Map<string, string>()
	let rejected = new Map<string, string>()
	let dirty = new Set<string>()
	let flight = new Set<string>()
	// What applying the register produced, including what tldraw derived from
	// it after the merge (bindings, groups), which it reports as user changes.
	let echoes = new Map<string, TLRecord | undefined>()
	let retry = false
	let newer = false
	pull()
	let stop = store.listen(
		({ changes }) => {
			for (let [id, record] of Object.entries(changes.added)) mark(id, record)
			for (let [id, [, after]] of Object.entries(changes.updated))
				mark(id, after)
			for (let id of Object.keys(changes.removed)) mark(id, undefined)
		},
		{ source: "user", scope: "document" },
	)
	return {
		store,
		pull,
		take,
		settle(values) {
			for (let [field, value] of values) {
				if (!field.startsWith(recordPrefix)) continue
				let id = field.slice(recordPrefix.length)
				flight.delete(id)
				let record = storedRecord(id, value)
				known.set(id, record ? schema + JSON.stringify(record.record) : "")
			}
			pull()
		},
		restore(values) {
			for (let [field] of values) {
				if (!field.startsWith(recordPrefix)) {
					retry = true
					continue
				}
				let id = field.slice(recordPrefix.length)
				flight.delete(id)
				dirty.add(id)
			}
		},
		pending: () => dirty.size > 0 || flight.size > 0 || retry,
		unsaved: () =>
			store
				.allRecords()
				.filter(
					record =>
						documentTypes.has(record.typeName) &&
						(dirty.has(record.id) || flight.has(record.id)),
				),
		newer: () => newer,
		discard,
		dispose: stop,
	}

	function mark(id: string, record: TLRecord | undefined) {
		let echo = echoes.has(id)
		let expected = echoes.get(id)
		echoes.delete(id)
		if (echo && expected === record) return
		dirty.add(id)
	}

	function discard() {
		retry = false
		if (!dirty.size) return
		let current = stored(fields()).records
		let local = store
			.allRecords()
			.filter(
				record =>
					dirty.has(record.id) &&
					!current.has(record.id) &&
					documentTypes.has(record.typeName),
			)
			.map(record => record.id)
		dirty.clear()
		for (let id of current.keys()) known.delete(id)
		apply(local, [])
		pull()
	}

	// The register as records, each with the schema it was written with. A
	// board half converted from a pre-tldraw drawing keeps the converted legacy
	// shapes until their records are written or deleted.
	function stored(current: Record<string, string>) {
		let schemas = boardSchemas(current)
		schemas.set(key, schema)
		let records = new Map<string, { value: string; schema: string }>()
		if (hasLegacyDrawing(current)) {
			let deleted = deletedRecords(current)
			for (let [id, value] of legacyRecords(current))
				if (!deleted.has(id)) records.set(id, { value, schema })
		}
		let relation: "same" | "older" | "newer" = "same"
		for (let [id, value] of boardRecords(current)) {
			let stored = storedRecord(id, value)
			let source = stored ? schemas.get(stored.schema) : undefined
			if (!stored || source === undefined) {
				records.set(id, { value, schema: "" })
				continue
			}
			let compared = compareSchema(source, schema)
			if (compared === "newer" || relation === "same") relation = compared
			records.set(id, { value: JSON.stringify(stored.record), schema: source })
		}
		return { records, relation }
	}

	function pull() {
		let current = stored(fields())
		newer = current.relation === "newer"
		let changed = new Map<string, { value: string; schema: string }>()
		for (let [id, entry] of current.records)
			if (known.get(id) !== entry.schema + entry.value) changed.set(id, entry)
		for (let id of known.keys())
			if (!current.records.has(id) && known.get(id))
				changed.set(id, { value: "", schema: "" })
		for (let id of changed.keys())
			if (dirty.has(id) || flight.has(id)) changed.delete(id)
		let removals = new Set<TLRecord["id"]>()
		let pages = [...current.records.keys()].filter(id => id.startsWith("page:"))
		// tldraw creates `page:page` for every new store; a board stored with
		// another page shows only that one.
		if (pages.length)
			for (let page of store.query.records("page").get())
				if (
					!current.records.has(page.id) &&
					!dirty.has(page.id) &&
					!flight.has(page.id)
				)
					removals.add(page.id)
		for (let record of store.allRecords())
			if (changed.get(record.id)?.value === "") removals.add(record.id)
		let groups = new Map<string, Map<string, string>>()
		for (let [id, entry] of changed) {
			if (!entry.value) continue
			if (rejected.get(id) === entry.schema + entry.value) continue
			let group = groups.get(entry.schema) ?? new Map<string, string>()
			group.set(id, entry.value)
			groups.set(entry.schema, group)
		}
		let updates: TLRecord[] = []
		let unreadable = 0
		for (let [source, values] of groups) {
			let result = source
				? readRecords(store.schema, source, values)
				: { records: [], failed: [...values.keys()] }
			updates.push(...result.records)
			for (let id of result.failed) {
				rejected.set(id, source + values.get(id))
				unreadable++
			}
		}
		if (unreadable)
			failed(
				new Error(
					newer
						? "This drawing was saved by a newer version of Alkalye; reload to edit it"
						: "Part of this drawing could not be read",
				),
			)
		if (removals.size || updates.length) apply([...removals], updates)
		for (let [id, entry] of changed) {
			if (entry.value && rejected.get(id) === entry.schema + entry.value) {
				known.delete(id)
				continue
			}
			rejected.delete(id)
			known.set(id, entry.value && entry.schema + entry.value)
		}
	}

	function apply(removals: TLRecord["id"][], updates: TLRecord[]) {
		let diff = store.extractingChanges(() =>
			store.mergeRemoteChanges(() => {
				if (removals.length) store.remove(removals)
				for (let record of updates) {
					let existing = store.get(record.id)
					if (existing && JSON.stringify(existing) === JSON.stringify(record))
						continue
					try {
						store.put([record])
					} catch (error) {
						failed(error)
					}
				}
			}),
		)
		for (let [id, record] of Object.entries(diff.added)) echoes.set(id, record)
		for (let [id, [, after]] of Object.entries(diff.updated))
			echoes.set(id, after)
		for (let id of Object.keys(diff.removed)) echoes.set(id, undefined)
	}

	// Opening a board never writes. The first edit writes the document and
	// page too, so a stored board is always a complete `.tldr` file, and
	// rewrites every record when the register still holds a pre-tldraw drawing
	// or records of an older schema. Each record names its schema, so a rewrite
	// cut short leaves a board that still reads correctly.
	function take(): [string, string][] {
		if (newer || (!dirty.size && !retry)) return []
		retry = false
		let current = fields()
		let board = stored(current)
		let legacy = hasLegacyDrawing(current)
		let rewrite = legacy || board.relation === "older"
		let storedPage = [...board.records.keys()].some(id =>
			id.startsWith("page:"),
		)
		let records = new Map<string, TLRecord>()
		let ids = new Set(dirty)
		for (let record of store.allRecords()) {
			if (!documentTypes.has(record.typeName)) continue
			records.set(record.id, record)
			if (
				rewrite ||
				record.typeName === "document" ||
				(record.typeName === "page" &&
					(!storedPage || board.records.has(record.id)))
			)
				ids.add(record.id)
		}
		let values: [string, string][] = []
		for (let id of ids) {
			if (flight.has(id)) continue
			let record = records.get(id)
			let value = record ? storedValue(key, record) : ""
			dirty.delete(id)
			let field = recordField(id)
			if (value === (current[field] ?? "") && (value || field in current)) {
				known.set(id, value && schema + JSON.stringify(record))
				continue
			}
			flight.add(id)
			values.push([field, value])
		}
		let tombstones = legacy ? legacyTombstones(current) : []
		if (!values.length && !tombstones.length) return []
		if (
			values.some(([, value]) => value) &&
			current[schemaField(key)] !== schema
		)
			values.unshift([schemaField(key), schema])
		values.push(...tombstones)
		return values
	}
}

// Imports are refused unless tldraw can migrate and validate every record,
// so a backup never restores a board that only partly opens.
export function checkBoardFile(file: TldrawFile) {
	let target = createTLStore().schema
	let groups = new Map<string, Map<string, string>>()
	for (let [id, value] of file.records) {
		let stored = storedRecord(id, value)
		if (!stored) throw new Error("A drawing could not be read")
		let group = groups.get(stored.schema) ?? new Map<string, string>()
		group.set(id, JSON.stringify(stored.record))
		groups.set(stored.schema, group)
	}
	for (let [key, values] of groups) {
		let schema = file.schemas.get(key)
		if (!schema || readRecords(target, schema, values).failed.length)
			throw new Error("A drawing could not be read")
	}
}

// The one place register values become tldraw records: each value is parsed
// on its own and must hold the record its field names, then tldraw's `.tldr`
// reader migrates the group from the schema it was written with and validates
// every record. A group that fails is read record by record, so one bad value
// only loses itself.
export function readRecords(
	target: TLSchema,
	source: string,
	values: ReadonlyMap<string, string>,
) {
	let failed: string[] = []
	let entries: [string, Record<string, unknown>][] = []
	let schema: unknown
	try {
		schema = object(JSON.parse(source))
	} catch {
		return { records: [], failed: [...values.keys()] }
	}
	for (let [id, value] of values) {
		let record: Record<string, unknown> | undefined
		try {
			record = documentRecord(id, JSON.parse(value))
		} catch {
			record = undefined
		}
		if (record) entries.push([id, record])
		else failed.push(id)
	}
	let whole = load(target, schema, entries)
	if (whole) return { records: whole, failed }
	let records: TLRecord[] = []
	for (let entry of entries) {
		let single = load(target, schema, [entry])
		if (single) records.push(...single)
		else failed.push(entry[0])
	}
	return { records, failed }
}

function load(
	target: TLSchema,
	schema: unknown,
	entries: ReadonlyArray<[string, Record<string, unknown>]>,
) {
	if (!entries.length) return []
	let result = parseTldrawJsonFile({
		json: JSON.stringify({
			tldrawFileFormatVersion: 1,
			schema,
			records: entries.map(([, record]) => record),
		}),
		schema: target,
	})
	if (!result.ok) return undefined
	let ids = new Set(entries.map(([id]) => id))
	let records = result.value.allRecords().filter(record => ids.has(record.id))
	result.value.dispose()
	return records.length === ids.size ? records : undefined
}
