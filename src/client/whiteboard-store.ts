import {
	DocumentRecordType,
	PageRecordType,
	TLDOCUMENT_ID,
	createBindingId,
	createTLStore,
	getIndexAbove,
	parseTldrawJsonFile,
	transact,
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
// tldraw reports changes on the next animation frame, which a background tab
// may never reach, so every step first collects what it has not reported yet.
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
	// The records not yet written and the ids deleted but not yet written, for
	// keeping them past a failed close.
	unsaved(): Draft
	// A board saved by a newer version is shown but never written.
	newer(): boolean
	// Drops edits that can no longer be written, such as after losing write
	// access, and shows the register again.
	discard(): void
	dispose(): void
}

export interface Draft {
	readonly records: TLRecord[]
	readonly removed: string[]
}

// Puts back a draft as the person's own edits, so they are written again.
export function restoreDraft(store: TLStore, draft: Draft) {
	let removed = new Set(draft.removed)
	let gone = store
		.allRecords()
		.filter(record => removed.has(record.id))
		.map(record => record.id)
	if (gone.length) store.remove(gone)
	if (draft.records.length) store.put(draft.records)
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
	// Set while the register is applied: tldraw reports what it derives from
	// a merge (bindings, groups) as user changes, which must not be written.
	let applying = false
	let retry = false
	let newer = false
	pull()
	let stop = store.listen(
		({ changes }) => {
			for (let id of Object.keys(changes.added)) mark(id)
			for (let id of Object.keys(changes.updated)) mark(id)
			for (let id of Object.keys(changes.removed)) mark(id)
		},
		{ source: "user", scope: "document" },
	)
	return {
		store,
		pull,
		take,
		settle(values) {
			collect()
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
		pending() {
			collect()
			return dirty.size > 0 || flight.size > 0 || retry
		},
		unsaved() {
			collect()
			let records = store
				.allRecords()
				.filter(record => documentTypes.has(record.typeName))
			let present = new Set<string>(records.map(record => record.id))
			return {
				records: records.filter(
					record => dirty.has(record.id) || flight.has(record.id),
				),
				removed: [...new Set([...dirty, ...flight])].filter(
					id => !present.has(id),
				),
			}
		},
		newer: () => newer,
		discard,
		dispose: stop,
	}

	// tldraw's user record is document scoped but not part of a board.
	function mark(id: string) {
		if (!applying && documentTypes.has(id.slice(0, id.indexOf(":"))))
			dirty.add(id)
	}

	function collect() {
		store._flushHistory()
	}

	function discard() {
		collect()
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
		collect()
		let register = fields()
		let current = stored(register)
		let deleted = deletedRecords(register)
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
			// Bindings an older arrow derives yield to stored and deleted ones.
			updates.push(
				...result.records.filter(
					record =>
						values.has(record.id) ||
						!(
							current.records.has(record.id) ||
							deleted.has(record.id) ||
							dirty.has(record.id) ||
							flight.has(record.id)
						),
				),
			)
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

	// Local edits are collected before the merge, and what tldraw derives from
	// it right after: at once in tests, on the next frame in browsers. One
	// transaction lets the editor see the store only once tldraw has restored
	// what the merge removed, such as the page and its camera.
	function apply(removals: TLRecord["id"][], updates: TLRecord[]) {
		collect()
		applying = true
		try {
			transact(() =>
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
			collect()
		} finally {
			applying = false
		}
	}

	// Opening a board never writes. The first edit writes the document and
	// page too, so a stored board is always a complete `.tldr` file, and
	// rewrites every record when the register still holds a pre-tldraw drawing
	// or records of an older schema. Each record names its schema, so a rewrite
	// cut short leaves a board that still reads correctly.
	function take(): [string, string][] {
		collect()
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
		// Bindings land before their arrows: an older arrow still stored derives
		// the same bindings, but a rewritten arrow no longer does.
		values.sort(
			([a], [b]) =>
				Number(!a.startsWith(recordField("binding:"))) -
				Number(!b.startsWith(recordField("binding:"))),
		)
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
	let migrated = result.value.allRecords()
	result.value.dispose()
	let ids = new Set(entries.map(([id]) => id))
	let records: TLRecord[] = []
	let found = 0
	for (let record of migrated) {
		if (ids.has(record.id)) {
			found++
			records.push(record)
			continue
		}
		// tldraw adds the document and page every store needs.
		if (record.typeName !== "shape" && record.typeName !== "binding") continue
		// Migrating arrows from before bindings creates a binding per bound end
		// with a random id. Naming it after its arrow and end lets every peer
		// derive the same record; anything else unrequested is not understood.
		if (
			record.typeName !== "binding" ||
			!ids.has(record.fromId) ||
			(record.props.terminal !== "start" && record.props.terminal !== "end")
		)
			return undefined
		let id = createBindingId(
			record.fromId.slice("shape:".length) + "." + record.props.terminal,
		)
		if (ids.has(id)) return undefined
		records.push({ ...record, id })
	}
	return found === ids.size ? records : undefined
}
