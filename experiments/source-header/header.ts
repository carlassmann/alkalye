import * as Schema from "effect/Schema"
import { frontmatterBlock, frontmatterKey } from "../../src/shared/markdown"

export let HeaderChangeSchema = Schema.Struct({
	id: Schema.String,
	migration: Schema.Boolean,
	changes: Schema.Array(
		Schema.Struct({ key: Schema.String, source: Schema.NullOr(Schema.String) }),
	),
})
export let HeaderSnapshotSchema = Schema.Array(
	Schema.Struct({
		key: Schema.String,
		id: Schema.String,
		migration: Schema.Boolean,
		source: Schema.NullOr(Schema.String),
	}),
)
type HeaderChange = typeof HeaderChangeSchema.Type
type Register = (typeof HeaderSnapshotSchema.Type)[number]
interface HeaderParts {
	entries: Map<string, string>
	body: string
}

export class SourceHeader {
	private entries = new Map<string, Register>()
	apply(change: HeaderChange) {
		for (let entry of change.changes) {
			let candidate = { ...entry, id: change.id, migration: change.migration }
			let previous = this.entries.get(entry.key)
			if (
				!previous ||
				(candidate.migration === previous.migration
					? candidate.id > previous.id
					: !candidate.migration)
			)
				this.entries.set(entry.key, candidate)
		}
	}
	change(
		id: string,
		previous: string,
		next: string,
		migration = false,
	): HeaderChange {
		let before = splitSource(previous),
			after = splitSource(next)
		let keys = new Set([...before.entries.keys(), ...after.entries.keys()])
		let changes: HeaderChange["changes"][number][] = []
		for (let key of keys) {
			let old = before.entries.get(key) ?? null,
				source = after.entries.get(key) ?? null
			if (old !== source) changes.push({ key, source })
		}
		return { id, migration, changes }
	}
	source(body: string) {
		let frame = this.entries.get("@open")
		let opening = frame?.source ?? "---\n"
		let order = this.entries.get("@order")?.source?.split("\n") ?? []
		let keys = [...this.entries.keys()].filter(key => {
			let value = this.entries.get(key)
			return (
				key.startsWith("entry:") &&
				value?.source !== null &&
				!(frame?.source === null && !frame.migration && value?.migration)
			)
		})
		keys.sort(
			(a, b) => position(a, order) - position(b, order) || a.localeCompare(b),
		)
		let content = keys.map(key => this.entries.get(key)?.source ?? "").join("")
		let decoration = this.entries.get("@comment")?.source ?? ""
		if (!keys.length && !decoration && frame?.source == null) return body
		let close = this.entries.get("@close")?.source ?? "---\n"
		if (body && !close.endsWith("\n"))
			close += opening.endsWith("\r\n") ? "\r\n" : "\n"
		return opening + decoration + content + close + body
	}
	snapshot(): typeof HeaderSnapshotSchema.Type {
		return [...this.entries.values()].sort((a, b) => a.key.localeCompare(b.key))
	}
	restore(snapshot: typeof HeaderSnapshotSchema.Type) {
		for (let entry of snapshot)
			this.apply({
				id: entry.id,
				migration: entry.migration,
				changes: [entry],
			})
	}
}
function position(key: string, order: string[]) {
	let index = order.indexOf(key)
	return index < 0 ? order.length : index
}
export function splitSource(source: string): HeaderParts {
	let match = frontmatterBlock(source)
	if (!match) return { entries: new Map(), body: source }
	let entries = new Map<string, string>([
		["@open", match[1] ?? ""],
		["@close", match[3] ?? ""],
	])
	let key = "@comment",
		order: string[] = []
	for (let line of (match[2] ?? "").match(/.*(?:\r?\n|$)/g) ?? []) {
		if (!line) continue
		let name = frontmatterKey(line)
		if (name) {
			if (entries.has("entry:" + name))
				throw new Error("Prototype excludes duplicate keys")
			key = "entry:" + name
			order.push(key)
		}
		entries.set(key, (entries.get(key) ?? "") + line)
	}
	entries.set("@order", order.join("\n"))
	return { entries, body: source.slice(match[0].length) }
}
