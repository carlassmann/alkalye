import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import type { Replica } from "./crdt"
import { frontmatter, withFrontmatter } from "./markdown"
import type { FrontmatterValue } from "./markdown"

export let sourceMetadataFields: readonly string[] = [
	"title",
	"path",
	"folder",
	"tags",
	"pinned",
	"archived",
	"commentsDisabled",
]

let text = Schema.String.pipe(
	Schema.catchDecoding(() => Effect.succeed(Option.some(""))),
	Schema.withDecodingDefault(Effect.succeed("")),
)
let flag = Schema.Union([
	Schema.Boolean,
	Schema.Literals(["true", "false"]),
]).pipe(
	Schema.decodeTo(Schema.Boolean, {
		decode: SchemaGetter.transform(value => value === true || value === "true"),
		encode: SchemaGetter.passthrough(),
	}),
	Schema.catchDecoding(() => Effect.succeed(Option.some(false))),
	Schema.withDecodingDefault(Effect.succeed(false)),
)
let tags = Schema.Union([Schema.Array(Schema.String), Schema.String]).pipe(
	Schema.decodeTo(Schema.Array(Schema.String), {
		decode: SchemaGetter.transform(value =>
			(typeof value === "string" ? value.split(",") : value)
				.map(tag => tag.trim())
				.filter(Boolean),
		),
		encode: SchemaGetter.passthrough(),
	}),
	Schema.catchDecoding(() => Effect.succeed(Option.some([]))),
	Schema.withDecodingDefault(Effect.succeed([])),
)
export let DocumentMetadataSchema = Schema.Struct({
	title: text,
	path: text,
	tags,
	pinned: flag,
	archived: flag,
	commentsDisabled: flag,
})
export type DocumentMetadata = typeof DocumentMetadataSchema.Type
export type MetadataPatch = {
	-readonly [Key in keyof DocumentMetadata]?: DocumentMetadata[Key]
}

export function documentMetadata(
	source: string,
	legacy: Record<string, string> = {},
) {
	let header = frontmatter(source)
	let data = header.data
	let fallback = legacy.metadata === "frontmatter-v1" ? {} : legacy
	let heading = header.body.match(/^#\s+(.+)$/m)?.[1] ?? ""
	let title =
		Object.hasOwn(data, "title") ||
		!fallback.title ||
		fallback.title === "Untitled"
			? data.title
			: fallback.title
	let metadata = Schema.decodeUnknownSync(DocumentMetadataSchema)({
		title,
		path: Object.hasOwn(data, "path") ? data.path : fallback.folder,
		tags: Object.hasOwn(data, "tags") ? data.tags : fallback.tags,
		pinned: Object.hasOwn(data, "pinned") ? data.pinned : fallback.pinned,
		archived: Object.hasOwn(data, "archived")
			? data.archived
			: fallback.archived,
		commentsDisabled: Object.hasOwn(data, "comments")
			? data.comments === false || data.comments === "false"
			: fallback.commentsDisabled,
	})
	return { ...metadata, title: metadata.title || heading || "Untitled" }
}

export function metadataSource(source: string, patch: MetadataPatch) {
	let values: Record<string, FrontmatterValue> = {}
	for (let [key, value] of Object.entries(patch)) {
		if (key === "commentsDisabled") values.comments = value ? false : undefined
		else
			values[key] =
				value === false ||
				value === "" ||
				(Array.isArray(value) && !value.length)
					? undefined
					: value
	}
	return withFrontmatter(source, values)
}

export function changeMetadata(
	replica: Replica,
	id: string,
	patch: MetadataPatch,
) {
	let fields = replica.fields(id)
	let source = replica.text(id)
	let operations = []
	if (fields.metadata !== "frontmatter-v1") {
		operations.push(
			replica.edit(
				id,
				canonicalDocumentSource(source, fields),
				replica.visible(id),
				{ migration: true },
			),
		)
		operations.push(replica.set(id, "metadata", "frontmatter-v1"))
		source = replica.text(id)
	}
	source = metadataSource(source, patch)
	operations.push(replica.edit(id, source))
	return operations
}

export function replaceDocumentSource(
	replica: Replica,
	id: string,
	source: string,
) {
	let operations = []
	let fields = replica.fields(id)
	if (fields.metadata !== "frontmatter-v1") {
		source = canonicalDocumentSource(source, fields)
		operations.push(replica.set(id, "metadata", "frontmatter-v1"))
	}
	operations.push(replica.edit(id, source))
	return operations
}

export function canonicalDocumentSource(
	source: string,
	fields: Record<string, string>,
) {
	if (fields.metadata === "frontmatter-v1") return source
	let previous = documentMetadata(source, fields)
	let migration: MetadataPatch = {}
	if (fields.title && fields.title !== "Untitled")
		migration.title = previous.title
	if (fields.folder) migration.path = previous.path
	if (fields.tags) migration.tags = previous.tags
	if (fields.pinned) migration.pinned = previous.pinned
	if (fields.archived) migration.archived = previous.archived
	if (fields.commentsDisabled)
		migration.commentsDisabled = previous.commentsDisabled
	return metadataSource(source, migration)
}

export function relocatedRange(
	previous: string,
	next: string,
	range: { start: number; end: number },
) {
	let previousStart = previous.length - frontmatter(previous).body.length
	let nextStart = next.length - frontmatter(next).body.length
	if (range.start >= previousStart)
		return {
			start: range.start + nextStart - previousStart,
			end: range.end + nextStart - previousStart,
		}
	let quote = previous.slice(range.start, range.end)
	let start = next.slice(0, nextStart).indexOf(quote)
	return start < 0 ? undefined : { start, end: start + quote.length }
}
