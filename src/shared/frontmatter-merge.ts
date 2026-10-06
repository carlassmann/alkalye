import { frontmatterBlock, frontmatterKey } from "./markdown"
import type { Atom } from "./model"
import * as Schema from "effect/Schema"
import * as Yaml from "effect/encoding/Yaml"

interface Entry {
	key: string | undefined
	atoms: Atom[]
}
interface Header {
	start: number
	open: Atom[]
	entries: Entry[]
	close: Atom[]
	end: number
}
interface SourceEdit {
	atoms: Atom[]
	next: string
	remove: Atom[]
	anchor?: string
	replace?: boolean
	order?: string[]
	observed?: string[]
	chain?: boolean
	ending?: "eof"
	deleted?: string[]
}
export let SourceUndoSchema = Schema.fromJsonString(
	Schema.Struct({
		hidden: Schema.Array(Schema.String),
		header: Schema.Array(Schema.String),
		order: Schema.Array(Schema.String),
		ending: Schema.optional(Schema.Literal("eof")),
	}),
)

export function sourceUndo(
	atoms: Atom[],
	removed: string[],
): typeof SourceUndoSchema.Type {
	let header = sourceHeaders(atoms)[0]
	let headerIds = new Set(
		header ? atoms.slice(header.start, header.end).map(atom => atom.id) : [],
	)
	let visibleIds = new Set(atoms.map(atom => atom.id))
	return {
		hidden: removed.filter(id => !visibleIds.has(id)),
		header: removed.filter(id => headerIds.has(id)),
		order: header ? headerKeys(header) : [],
		...(header && !header.close.at(-1)?.value.endsWith("\n")
			? { ending: "eof" }
			: {}),
	}
}

export function sourceObserved(atoms: Atom[]) {
	let header = sourceHeaders(atoms)[0]
	return header ? observedEntries(header) : []
}

export function inverseHeader(
	removed: Atom[],
	current: Atom[],
	removing: Set<string>,
	order: readonly string[],
) {
	if (!removed.length) return undefined
	let value = sourceText(removed)
	let framed = frontmatterBlock(value)
	let open = framed
		? removed.slice(0, Array.from(framed[1] ?? "").length)
		: literalAtoms("---\n")
	let close = framed
		? removed.slice(
				Array.from(framed[1] ?? "").length + Array.from(framed[2] ?? "").length,
				Array.from(framed[0]).length,
			)
		: literalAtoms("---\n")
	let content = framed
		? removed.slice(open.length, removed.length - close.length)
		: removed
	let original = sourceHeaders([
		...literalAtoms("---\n"),
		...content,
		...literalAtoms("---\n"),
	])[0]
	let active = sourceHeaders(current)[0]
	let live = new Map<string, Entry>()
	for (let entry of active?.entries ?? [])
		if (entry.key) live.set(entry.key, entry)
	let entries =
		original?.entries.filter(entry => {
			if (!entry.key)
				return (
					!active ||
					active.entries
						.filter(candidate => !candidate.key)
						.every(candidate =>
							candidate.atoms.every(atom => removing.has(atom.id)),
						)
				)
			let present = live.get(entry.key)
			return !present || removing.has(present.atoms[0]?.id ?? "")
		}) ?? []
	if (!entries.length) return undefined
	let keys = new Set([
		...live.keys(),
		...entries.flatMap(entry => (entry.key ? [entry.key] : [])),
	])
	let combined = [...new Set([...order, ...keys])].filter(key => keys.has(key))
	return {
		atoms: [...open, ...entries.flatMap(entry => entry.atoms), ...close],
		order: combined,
	}
}

function literalAtoms(source: string): Atom[] {
	return Array.from(source).map((value, index) => ({
		id: "",
		after: index ? "literal" : "",
		value,
	}))
}
export function sourceAtoms(
	raw: Atom[],
	originalFrames: () => readonly Atom[][] = () => [],
) {
	let headers = sourceHeaders(raw)
	if (!headers.length) return raw
	let winners = new Map<
		string,
		{ entry?: Entry; id: string; migration: boolean }
	>()
	for (let header of headers) {
		let opening = header.open[0]
		if (!opening) continue
		for (let entry of header.entries) {
			let key = entry.key ?? ""
			let candidate = {
				entry,
				id: entry.atoms[0]?.id ?? "",
				migration: Boolean(opening.migration),
			}
			let previous = winners.get(key)
			if (!previous || outranks(candidate, previous))
				winners.set(key, candidate)
		}
		for (let key of opening.deleted ?? []) {
			let candidate = { id: opening.id, migration: false }
			let previous = winners.get(key)
			if (!previous || outranks(candidate, previous))
				winners.set(key, candidate)
		}
	}
	let first = headers[0],
		last = headers.at(-1)
	if (!first || !last) return raw
	let format = headers
		.filter(header => header.open[0]?.order)
		.sort((a, b) => ((a.open[0]?.id ?? "") > (b.open[0]?.id ?? "") ? -1 : 1))[0]
	let order =
		format?.open[0]?.order ??
		headers.flatMap(header =>
			header.entries.flatMap(entry => (entry.key ? [entry.key] : [])),
		)
	let entries = headers.flatMap(header =>
		header.entries.filter(entry =>
			sameOperation(
				winners.get(entry.key ?? "")?.entry?.atoms[0]?.id,
				entry.atoms[0]?.id,
			),
		),
	)
	entries.sort((a, b) => entryPosition(a, order) - entryPosition(b, order))
	entries = withoutLostAliases(entries, headers, originalFrames)
	let body: Atom[] = [],
		position = 0
	for (let header of headers) {
		body.push(...raw.slice(position, header.start))
		position = header.end
	}
	body.push(...raw.slice(position))
	if (
		!entries.length &&
		headers.some(header => header.open[0]?.deleted?.length)
	)
		return body
	let close = format?.close ?? last.close
	if (!body.length && format?.open[0]?.ending === "eof")
		close = close.filter(atom => atom.value !== "\n" && atom.value !== "\r")
	return [
		...(format?.open ?? first.open),
		...entries.flatMap(entry => entry.atoms),
		...close,
		...body,
	]
}

export function sourceEdits(
	atoms: Atom[],
	next: string,
	raw = atoms,
	current = atoms,
): SourceEdit[] {
	let previousHeaders = sourceHeaders(atoms)
	let nextAtoms = Array.from(next).map((value, index) => ({
		id: `next:${index}`,
		after: index ? `next:${index - 1}` : "",
		value,
	}))
	let nextHeaders = sourceHeaders(nextAtoms)
	let previous = previousHeaders[0],
		following = nextHeaders[0]
	let active = sourceHeaders(current)[0]
	if (previous && following && active && current !== atoms)
		following = rebaseHeader(previous, following, active)
	if (!previous && following)
		return [
			{
				atoms: [],
				next: frameText(following),
				remove: [],
				anchor: "",
				replace: true,
				order: headerKeys(following),
				ending: headerEnding(following),
			},
			{
				atoms,
				next: nextAtoms
					.slice(following.end)
					.map(atom => atom.value)
					.join(""),
				remove: [],
				chain: true,
			},
		]
	if (previous && !following) {
		let body = atoms.slice(previous.end)
		let bodySource = body.map(atom => atom.value).join("")
		let prefix =
			bodySource && next.endsWith(bodySource)
				? next.slice(0, -bodySource.length)
				: ""
		return [
			{
				atoms: [],
				next: headerKeys(previous).length ? "---\n---\n" : "",
				remove: sourceHeaders(raw).flatMap(frameAtoms),
				anchor: "",
				replace: true,
				order: [],
				deleted: headerKeys(previous),
				observed: observedEntries(previous),
			},
			{ atoms: [], next: prefix, remove: [], anchor: "", replace: true },
			{
				atoms: body,
				next: next.slice(prefix.length),
				remove: [],
				anchor: previous.close.at(-1)?.id,
			},
		]
	}
	if (!previous || !following) return [{ atoms, next, remove: [] }]
	let edits: SourceEdit[] = []
	let body: SourceEdit = {
		atoms: atoms.slice(previous.end),
		next: nextAtoms
			.slice(following.end)
			.map(atom => atom.value)
			.join(""),
		remove: [],
		anchor: previous.close.at(-1)?.id ?? "",
	}
	if (
		atoms
			.slice(0, previous.end)
			.map(atom => atom.value)
			.join("") ===
		nextAtoms
			.slice(0, following.end)
			.map(atom => atom.value)
			.join("")
	)
		return [body]
	let previousDecoration = previous.entries
		.filter(entry => !entry.key)
		.flatMap(entry => entry.atoms)
		.map(atom => atom.value)
		.join("")
	let nextDecoration = following.entries
		.filter(entry => !entry.key)
		.flatMap(entry => entry.atoms)
		.map(atom => atom.value)
		.join("")
	let fencesChanged =
		previous.open.map(atom => atom.value).join("") !==
			following.open.map(atom => atom.value).join("") ||
		previous.close.map(atom => atom.value).join("") !==
			following.close.map(atom => atom.value).join("")
	if (duplicateKeys(previous.entries) || duplicateKeys(following.entries))
		return [
			{
				atoms: atoms.slice(0, previous.end),
				next: frameText(following),
				remove: sourceHeaders(raw).flatMap(frameAtoms),
				deleted: headerKeys(previous).filter(
					key => !headerKeys(following).includes(key),
				),
				anchor: "",
				replace: true,
				order: headerKeys(following),
				observed: observedEntries(previous),
				ending: headerEnding(following),
			},
			body,
		]
	let entries = new Map(
		previous.entries
			.filter(entry => entry.key)
			.map(entry => [entry.key, entry]),
	)
	let rawEntries = sourceHeaders(raw).flatMap(header => header.entries)
	let remaining = new Set(entries.keys())
	let decorationChanged = previousDecoration !== nextDecoration
	let changed: Atom[] = decorationChanged
		? following.entries
				.filter(entry => !entry.key)
				.flatMap(entry => entry.atoms)
		: []
	let removed: Atom[] = decorationChanged
		? rawEntries.filter(entry => !entry.key).flatMap(entry => entry.atoms)
		: []
	for (let entry of following.entries) {
		if (!entry.key) continue
		let old = entries.get(entry.key)
		remaining.delete(entry.key)
		let value = sourceText(entry.atoms)
		if (old && sourceText(old.atoms) === value) continue
		removed.push(
			...rawEntries
				.filter(candidate => candidate.key === entry.key)
				.flatMap(candidate => candidate.atoms),
		)
		changed.push(...entry.atoms)
	}
	for (let key of remaining) {
		let old = entries.get(key)
		if (old)
			removed.push(
				...rawEntries
					.filter(entry => entry.key === key)
					.flatMap(entry => entry.atoms),
			)
	}
	if (changed.length || removed.length || fencesChanged)
		edits.push({
			atoms: [],
			next:
				changed.length || remaining.size || fencesChanged
					? frameText({
							...following,
							entries: [{ key: undefined, atoms: changed }],
						})
					: "",
			remove: removed,
			deleted: [...remaining].flatMap(key => (key ? [key] : [])),
			observed: observedEntries(previous),
			anchor: "",
			replace: true,
			order: headerKeys(following),
			ending: headerEnding(following),
		})
	edits.push(body)
	return edits
}

function sourceHeaders(atoms: Atom[]) {
	if (
		!atoms.some(
			atom =>
				atom.after === "" && (atom.value === "-" || atom.value === "\uFEFF"),
		)
	)
		return []
	let source = sourceText(atoms)
	let headers: Header[] = []
	let sourceOffset = 0
	for (let [offset, atom] of atoms.entries()) {
		let candidate = sourceOffset
		sourceOffset += atom.value.length
		if (
			offset < (headers.at(-1)?.end ?? 0) ||
			atom.after !== "" ||
			(atom.value !== "-" && atom.value !== "\uFEFF")
		)
			continue
		// A body separator must not consume a declared header from another root.
		let match = frontmatterBlock(source.slice(candidate))
		if (!match) continue
		let openLength = Array.from(match[1] ?? "").length
		let headerLength = Array.from(match[2] ?? "").length
		let end = offset + Array.from(match[0]).length
		if (
			atoms
				.slice(offset + 1, end)
				.some(atom => atom.after === "" && atom.order !== undefined)
		)
			continue
		let entries: Entry[] = []
		let position = offset + openLength
		for (let line of (match[2] ?? "").match(/.*(?:\r?\n|$)/g) ?? []) {
			if (!line) continue
			let key = frontmatterKey(line)
			let characters = atoms.slice(position, position + Array.from(line).length)
			let previous = entries.at(-1)
			if (!key && previous) previous.atoms.push(...characters)
			else entries.push({ key, atoms: characters })
			position += characters.length
		}
		headers.push({
			start: offset,
			open: atoms.slice(offset, offset + openLength),
			entries,
			close: atoms.slice(offset + openLength + headerLength, end),
			end,
		})
	}
	return headers
}

function entryPosition(entry: Entry, order: readonly string[]) {
	if (!entry.key) return -1
	let position = order.indexOf(entry.key)
	return position < 0 ? order.length : position
}
function headerKeys(header: Header) {
	return header.entries.flatMap(entry => (entry.key ? [entry.key] : []))
}
function rebaseHeader(previous: Header, next: Header, current: Header) {
	let before = new Map(
		previous.entries.map(entry => [entry.key, sourceText(entry.atoms)]),
	)
	let active = new Map(current.entries.map(entry => [entry.key, entry]))
	let entries = next.entries.flatMap(entry => {
		if (!entry.key || before.get(entry.key) !== sourceText(entry.atoms))
			return [entry]
		let present = active.get(entry.key)
		return present ? [present] : []
	})
	let included = new Set(entries.map(entry => entry.key))
	for (let entry of current.entries)
		if (entry.key && !before.has(entry.key) && !included.has(entry.key))
			entries.push(entry)
	return { ...next, entries }
}
function headerEnding(header: Header): "eof" | undefined {
	return header.close.at(-1)?.value.endsWith("\n") ? undefined : "eof"
}
function frameText(header: Header) {
	let value = sourceText(frameAtoms(header))
	return value.endsWith("\n") ? value : value + "\n"
}

function sourceText(atoms: readonly Atom[]) {
	return atoms.map(atom => atom.value).join("")
}

function duplicateKeys(entries: Entry[]) {
	let keys = entries.flatMap(entry => (entry.key ? [entry.key] : []))
	return new Set(keys).size !== keys.length
}

function frameAtoms(header: Header) {
	return [
		...header.open,
		...header.entries.flatMap(entry => entry.atoms),
		...header.close,
	]
}

function outranks(
	candidate: { id: string; migration: boolean },
	previous: { id: string; migration: boolean },
) {
	return candidate.migration === previous.migration
		? candidate.id > previous.id
		: !candidate.migration
}
function sameOperation(first: string | undefined, second: string | undefined) {
	return Boolean(first && second && first.slice(0, -9) === second.slice(0, -9))
}

function withoutLostAliases(
	entries: Entry[],
	headers: Header[],
	originalFrames: () => readonly Atom[][],
) {
	let candidates = headers.flatMap(header => header.entries)
	let originalEntries: Entry[] | undefined
	if (
		!sourceText(entries.flatMap(entry => entry.atoms)).includes("*") ||
		parsesEntries(entries)
	)
		return entries
	let kept: Entry[] = []
	for (let entry of entries) {
		let prefix = [...kept, entry]
		let dependsOnLoser =
			parsesEntries(kept) &&
			!parsesEntries(prefix) &&
			kept.some((previous, index) =>
				candidates.some(
					candidate =>
						candidate.key === previous.key &&
						candidate !== previous &&
						parsesEntries([
							...kept.slice(0, index),
							candidate,
							...kept.slice(index + 1),
							entry,
						]),
				),
			)
		let dependsOnDeletion = false
		if (!dependsOnLoser && parsesEntries(kept) && !parsesEntries(prefix)) {
			let owner = headers.find(header => header.entries.includes(entry))
			// Key names alone cannot show whether a writer saw a concurrent value replacement.
			let unseenDeletions = headers.flatMap(header =>
				(header.open[0]?.deleted ?? []).filter(
					key =>
						owner?.open[0]?.order?.includes(key) &&
						entry.key !== undefined &&
						(header.open[0]?.observed !== undefined
							? !header.open[0].observed.includes(entry.atoms[0]?.id ?? "")
							: !header.open[0]?.order?.includes(entry.key)),
				),
			)
			if (unseenDeletions.length) {
				originalEntries ??= originalFrames().flatMap(frame =>
					sourceHeaders(frame).flatMap(header => header.entries),
				)
				dependsOnDeletion = originalEntries.some(
					candidate =>
						candidate.key !== undefined &&
						unseenDeletions.includes(candidate.key) &&
						(owner?.open[0]?.observed?.includes(candidate.atoms[0]?.id ?? "") ||
							sameOperation(candidate.atoms[0]?.id, entry.atoms[0]?.id)) &&
						parsesEntries([...kept, candidate, entry]),
				)
			}
		}
		if (!dependsOnLoser && !dependsOnDeletion) kept.push(entry)
	}
	return kept
}

function parsesEntries(entries: Entry[]) {
	try {
		Yaml.parse(sourceText(entries.flatMap(entry => entry.atoms)))
		return true
	} catch {
		return false
	}
}

function observedEntries(header: Header) {
	return header.entries.flatMap(entry =>
		entry.key && entry.atoms[0] ? [entry.atoms[0].id] : [],
	)
}
