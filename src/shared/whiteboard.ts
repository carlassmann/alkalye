import { maximumActionText } from "./document-actions"
import { isLegacyField } from "./legacy-drawing"
import { array, object, string } from "./model"

// A whiteboard is one `type: whiteboard` register. Every tldraw document
// record lives in its own field, `record:<id>`, so concurrent edits to
// different shapes merge and each action is undoable like any other register
// change. A deleted record leaves an empty string. Each value names the
// tldraw schema it was written with, stored once in `schema:<key>`, so a
// board converted in several actions is never misread when only some of them
// land: every record is migrated from its own schema. `preview` caches an SVG
// for documents and slides that must not load tldraw.
export let recordPrefix = "record:"
export let schemaPrefix = "schema:"
export let previewField = "preview"
export let darkPreviewField = "preview-dark"
export let documentTypes = new Set(["document", "page", "shape", "binding"])

// Previews are a cache; a larger one is left out and rendered on demand.
export let maximumPreview = 120_000

let unsupportedShapes = new Set(["image", "video", "embed", "bookmark"])
let operationBudget = 900
let textBudget = 180_000

// Records by id, each as its stored value, with the schemas they name.
export interface TldrawFile {
	readonly schemas: ReadonlyMap<string, string>
	readonly records: ReadonlyMap<string, string>
}

export interface StoredRecord {
	readonly schema: string
	readonly record: Record<string, unknown>
}

export function recordField(id: string) {
	return recordPrefix + id
}

export function schemaField(key: string) {
	return schemaPrefix + key
}

export function schemaKey(schema: string) {
	return digest([schema])
}

export function storedValue(key: string, record: unknown) {
	return JSON.stringify({ schema: key, record })
}

export function boardRecords(fields: Record<string, string>) {
	let records = new Map<string, string>()
	for (let [key, value] of Object.entries(fields))
		if (key.startsWith(recordPrefix) && value)
			records.set(key.slice(recordPrefix.length), value)
	return records
}

// Deleted records too, so a deletion hides a legacy shape not yet removed.
export function deletedRecords(fields: Record<string, string>) {
	let deleted = new Set<string>()
	for (let [key, value] of Object.entries(fields))
		if (key.startsWith(recordPrefix) && !value)
			deleted.add(key.slice(recordPrefix.length))
	return deleted
}

export function boardSchemas(fields: Record<string, string>) {
	let schemas = new Map<string, string>()
	for (let [key, value] of Object.entries(fields))
		if (key.startsWith(schemaPrefix) && value)
			schemas.set(key.slice(schemaPrefix.length), value)
	return schemas
}

export function isTldrawBoard(fields: Record<string, string>) {
	return boardRecords(fields).size > 0
}

export function hasLegacyDrawing(fields: Record<string, string>) {
	return Object.entries(fields).some(
		([key, value]) => isLegacyField(key) && value,
	)
}

export function legacyTombstones(fields: Record<string, string>) {
	return Object.entries(fields)
		.filter(([key, value]) => isLegacyField(key) && value)
		.map(([key]): [string, string] => [key, ""])
}

// A register value as the record its field names and the schema key it was
// written with, or nothing when a peer stored something else there.
export function storedRecord(
	id: string,
	value: string,
): StoredRecord | undefined {
	try {
		let stored = object(JSON.parse(value))
		let record = documentRecord(id, stored.record)
		if (typeof stored.schema !== "string" || !record) return undefined
		return { schema: stored.schema, record }
	} catch {
		return undefined
	}
}

export function documentRecord(id: string, value: unknown) {
	try {
		let record = object(value)
		let typeName = record.typeName
		if (
			record.id !== id ||
			typeof typeName !== "string" ||
			!documentTypes.has(typeName) ||
			!id.startsWith(typeName + ":")
		)
			return undefined
		return record
	} catch {
		return undefined
	}
}

// How a stored tldraw schema relates to this client's: records of an older
// one are migrated, a newer one has sequences or versions this client lacks.
export function compareSchema(
	stored: string,
	current: string,
): "same" | "older" | "newer" {
	let versions = (source: string) => {
		try {
			let schema = object(JSON.parse(source))
			if (schema.schemaVersion !== 2)
				return typeof schema.schemaVersion === "number" &&
					schema.schemaVersion > 2
					? "newer"
					: "older"
			let sequences = new Map<string, number>()
			for (let [name, version] of Object.entries(object(schema.sequences)))
				if (typeof version === "number") sequences.set(name, version)
			return sequences
		} catch {
			return "older"
		}
	}
	if (stored === current) return "same"
	let mine = versions(current),
		theirs = versions(stored)
	if (typeof theirs === "string" || typeof mine === "string")
		return theirs === "newer" ? "newer" : "older"
	for (let [name, version] of theirs) {
		let known = mine.get(name)
		if (known === undefined || version > known) return "newer"
	}
	for (let [name, version] of mine)
		if (theirs.get(name) !== version) return "older"
	return "same"
}

// The `.tldr` file tldraw itself reads and writes, assembled from the stored
// records without loading tldraw; tldraw migrates it when opening it. A board
// whose conversion was interrupted holds records of several schemas and is
// saved as one `.tldr` file per schema.
export function boardFile(fields: Record<string, string>) {
	let schemas = boardSchemas(fields)
	let groups = new Map<string, Record<string, unknown>[]>()
	for (let [id, value] of boardRecords(fields)) {
		let stored = storedRecord(id, value)
		if (!stored || !schemas.has(stored.schema)) continue
		let group = groups.get(stored.schema) ?? []
		group.push(stored.record)
		groups.set(stored.schema, group)
	}
	let files: Record<string, unknown>[] = []
	for (let [key, records] of groups) {
		let schema: unknown
		try {
			schema = object(JSON.parse(schemas.get(key) ?? ""))
		} catch {
			continue
		}
		files.push({ tldrawFileFormatVersion: 1, schema, records })
	}
	if (!files.length) return undefined
	return JSON.stringify(
		files.length === 1 ? files[0] : { format: "alkalye-tldraw-v2", files },
	)
}

// Checks what tldraw cannot check without loading: one page, record
// identities that match their types and are unique, and shapes and bindings
// that refer to records in the file. tldraw validates each record when the
// board opens.
export function parseTldrawFile(value: unknown): TldrawFile {
	let file = object(value)
	if (file.format === "alkalye-tldraw-v1")
		return parseTldrawFile(JSON.parse(string(file.snapshot)))
	let parts = file.format === "alkalye-tldraw-v2" ? array(file.files) : [file]
	let schemas = new Map<string, string>()
	let records = new Map<string, string>()
	let entries: Record<string, unknown>[] = []
	for (let part of parts) {
		let source = object(part)
		if (source.tldrawFileFormatVersion !== 1)
			throw new Error("Unsupported drawing format")
		let schema = JSON.stringify(object(source.schema))
		let key = schemaKey(schema)
		schemas.set(key, schema)
		for (let entry of array(source.records)) {
			let record = object(entry)
			let id = string(record.id),
				typeName = string(record.typeName)
			if (!/^[\w:.-]{1,200}$/.test(id) || !id.startsWith(typeName + ":"))
				throw new Error("Drawing contains an invalid identity")
			if (
				typeName === "asset" ||
				(typeName === "shape" && unsupportedShapes.has(String(record.type)))
			)
				throw new Error("Embedded media is not supported in drawings")
			if (!documentTypes.has(typeName)) continue
			if (records.has(id)) throw new Error("Drawing contains a record twice")
			if (typeName === "document" && id !== "document:document")
				throw new Error("Drawing contains an invalid identity")
			let stored = storedValue(key, record)
			if (stored.length > maximumActionText)
				throw new Error("A drawing shape is too large")
			records.set(id, stored)
			entries.push(record)
		}
	}
	let pages = entries.filter(record => record.typeName === "page")
	if (pages.length !== 1) throw new Error("Import a drawing with one page")
	for (let record of entries) {
		let references =
			record.typeName === "shape"
				? [record.parentId]
				: record.typeName === "binding"
					? [record.fromId, record.toId]
					: []
		for (let reference of references)
			if (
				typeof reference !== "string" ||
				!records.has(reference) ||
				!(reference.startsWith("shape:") || reference.startsWith("page:")) ||
				(record.typeName === "binding" && !reference.startsWith("shape:"))
			)
				throw new Error("Drawing refers to a missing shape")
	}
	return { schemas, records }
}

// Replaces whatever the board held with the file's records. Schemas the
// file needs lead, so each record lands with its schema in place.
export function boardFileFields(
	fields: Record<string, string>,
	file: TldrawFile,
): [string, string][] {
	let values: [string, string][] = []
	for (let [key, schema] of file.schemas)
		if (fields[schemaField(key)] !== schema)
			values.push([schemaField(key), schema])
	for (let id of boardRecords(fields).keys())
		if (!file.records.has(id)) values.push([recordField(id), ""])
	for (let [id, record] of file.records)
		if (fields[recordField(id)] !== record)
			values.push([recordField(id), record])
	values.push(...legacyTombstones(fields))
	for (let key of boardSchemas(fields).keys())
		if (!file.schemas.has(key)) values.push([schemaField(key), ""])
	if (fields[previewField]) values.push([previewField, ""])
	if (fields[darkPreviewField]) values.push([darkPreviewField, ""])
	return values
}

// Splits register writes into actions the server accepts, which bounds both
// the values written and the values they replace. Schemas lead, so no record
// lands before the schema it names, and removed schemas and the preview
// travel last, so a reader never sees a preview of records not stored yet.
export function writeBatches(
	values: ReadonlyArray<[string, string]>,
	fields: Record<string, string> = {},
) {
	let batches: [string, string][][] = []
	let batch: [string, string][] = []
	let written = 0,
		replaced = 0
	let ordered = [
		...values.filter(
			([field, value]) => field.startsWith(schemaPrefix) && value,
		),
		...values.filter(([field]) => field.startsWith(recordPrefix)),
		...values.filter(
			([field, value]) =>
				!field.startsWith(recordPrefix) &&
				!(field.startsWith(schemaPrefix) && value),
		),
	]
	for (let value of ordered) {
		let size = value[1].length,
			before = (fields[value[0]] ?? "").length
		if (
			batch.length &&
			(batch.length >= operationBudget ||
				written + size > textBudget ||
				replaced + before > textBudget)
		) {
			batches.push(batch)
			batch = []
			written = 0
			replaced = 0
		}
		batch.push(value)
		written += size
		replaced += before
	}
	if (batch.length) batches.push(batch)
	return batches
}

// Names the records a cached preview shows, so a preview written before a
// peer's concurrent edit merged in is not mistaken for the board.
export function previewKey(fields: Record<string, string>) {
	let entries = [...boardRecords(fields)].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	)
	return (
		digest(entries.flatMap(([id, value]) => [id, value, "\n"])) +
		entries.length.toString(36)
	)
}

function digest(texts: ReadonlyArray<string>) {
	let hash = 0x811c9dc5,
		second = 0
	for (let text of texts)
		for (let index = 0; index < text.length; index++) {
			let code = text.charCodeAt(index)
			hash = Math.imul(hash ^ code, 0x01000193)
			second = Math.imul(second + code, 0x9e3779b1) ^ (second >>> 15)
		}
	return (hash >>> 0).toString(36) + (second >>> 0).toString(36)
}

// A preview carries the key of the records it shows; any other preview is
// stale and the board is drawn again.
export function stampPreview(svg: string, key: string) {
	return "<!--alkalye:" + key + "-->" + svg
}

export function freshPreview(fields: Record<string, string>, field: string) {
	let preview = fields[field] ?? ""
	let match = /^<!--alkalye:([\w]+)-->/.exec(preview)
	if (!match || match[1] !== previewKey(fields)) return undefined
	return preview.slice(match[0].length)
}
