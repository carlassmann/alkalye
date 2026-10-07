import type { CausalReplicaCheckpoint, ReplicaCheckpoint } from "./checkpoint"
import { TextVisibility } from "./text-visibility"
import type { VisibilityFact } from "./text-visibility"
import { parseOperation, expandDeletions } from "./model"
import { frontmatter, frontmatterBlock } from "./markdown"
import * as Schema from "effect/Schema"
import { documentMetadata } from "./document-metadata"
import type { DocumentMetadata } from "./document-metadata"
import {
	sourceAtoms,
	sourceEdits,
	sourceUndo,
	sourceObserved,
	inverseHeader,
	SourceUndoSchema,
} from "./frontmatter-merge"
import type { Atom, DocumentRecord, Operation } from "./model"
import { TextIndex } from "./text-index"
import { immutableAtoms, replaceAtoms } from "./atom-sequence"
import { textSplices } from "./text-splices"

export interface TextReplacement {
	start: number
	remove: number
	text: string
}

let sourceViews = new WeakMap<Atom[], Atom[]>()
let sourceOffsets = new WeakMap<Atom[], TextIndex>()
interface PreparedTextEdit {
	id: string
	target: string
	generation: number
	signature: string
	content: string
	atoms: Atom[]
	raw: Atom[]
	splices: { start: number; remove: number; inserted: string[] }[]
}

export class Replica {
	operations = new Map<string, Operation>()
	clock = 0
	historyLoaded = true
	private atomIndex = new Map<string, { target: string; atom: Atom }>()
	private children = new Map<string, Map<string, Atom[]>>()
	private visibility = new Map<string, TextVisibility>()
	private textOwners = new Map<string, string>()
	private ownedAtomCounts = new Map<string, number>()
	private stateGeneration = 0
	private registers = new Map<string, Map<string, Operation>>()
	private targets = new Map<string, Operation[]>()
	private strings = new Map<string, string>()
	private updated = new Map<string, number>()
	private created = new Map<string, number>()
	private restored = new Map<string, string>()
	private textCache = new Map<string, Atom[]>()
	private sourceCache = new Map<string, Atom[]>()
	private fieldCache = new Map<string, Record<string, string>>()
	private metadataCache = new Map<string, DocumentMetadata>()
	private preparedEdit: PreparedTextEdit | undefined
	constructor(
		public actor: string,
		public author = "Writer",
	) {}
	fork(actor = this.actor, author = this.author) {
		let replica = new Replica(actor, author)
		for (let operation of this.operations.values()) freezeFact(operation)
		for (let fields of this.registers.values())
			for (let operation of fields.values()) freezeFact(operation)
		replica.operations = new Map(this.operations)
		replica.clock = this.clock
		replica.historyLoaded = this.historyLoaded
		replica.atomIndex = new Map(this.atomIndex)
		replica.children = new Map(
			[...this.children].map(([target, children]) => [
				target,
				new Map(children),
			]),
		)
		replica.visibility = new Map(
			[...this.visibility].map(([target, visibility]) => [
				target,
				visibility.fork(),
			]),
		)
		replica.textOwners = new Map(this.textOwners)
		replica.ownedAtomCounts = new Map(this.ownedAtomCounts)
		replica.stateGeneration = this.stateGeneration
		replica.registers = new Map(
			[...this.registers].map(([target, fields]) => [target, new Map(fields)]),
		)
		replica.targets = new Map(
			[...this.targets].map(([target, history]) => [target, [...history]]),
		)
		replica.strings = new Map(this.strings)
		replica.updated = new Map(this.updated)
		replica.created = new Map(this.created)
		replica.restored = new Map(this.restored)
		return replica
	}
	get generation() {
		return this.stateGeneration
	}
	apply(input: Operation[]) {
		let edit = this.preparedEdit
		this.preparedEdit = undefined
		this.prepare(input)()
		let operation = this.operations.get(input[0]?.id ?? "")
		if (
			!edit ||
			input.length !== 1 ||
			!operation ||
			operation.id !== edit.id ||
			this.generation !== edit.generation + 1 ||
			textEditSignature(operation) !== edit.signature
		)
			return
		let replacements = edit.splices.map(splice => ({
			start: splice.start,
			remove: splice.remove,
			inserted: splice.inserted.flatMap(id => {
				let atom = this.atomIndex.get(id)?.atom
				return atom ? [atom] : []
			}),
		}))
		let atoms = replaceAtoms(edit.atoms, replacements)
		let raw =
			edit.raw === edit.atoms
				? atoms
				: replaceAtoms(
						edit.raw,
						replacements.map(change => ({
							...change,
							start:
								change.start === edit.atoms.length
									? edit.raw.length
									: change.start,
						})),
					)
		let previousIndex = sourceOffsets.get(edit.atoms)
		if (previousIndex) {
			let index = previousIndex.fork()
			for (let change of [...replacements].reverse())
				index.replace({
					start: previousIndex.offsetAtCodePoint(change.start),
					end: previousIndex.offsetAtCodePoint(change.start + change.remove),
					insert: change.inserted.map(atom => atom.value).join(""),
				})
			sourceOffsets.set(atoms, index)
		}
		this.textCache.set(edit.target, raw)
		this.sourceCache.set(edit.target, atoms)
		sourceViews.set(atoms, raw)
		this.strings.set(edit.target, edit.content)
	}

	validate(input: Operation[]) {
		this.prepare(input)
	}
	private prepare(input: Operation[]) {
		let operations = input.map(parseOperation)
		this.validateIdentities(operations)
		let facts = new Map<string, VisibilityFact[]>()
		for (let operation of operations) {
			let changes = facts.get(operation.target) ?? []
			let [first, ...rest] = operation.remove
			if (operation.kind === "text" && first !== undefined)
				changes.push({
					kind: "remove",
					id: operation.id,
					atoms: [first, ...rest],
				})
			if (operation.kind === "cancel")
				changes.push({
					kind: "cancel",
					id: operation.id,
					target: operation.value,
				})
			if (changes.length) facts.set(operation.target, changes)
		}
		let commits: (() => void)[] = []
		for (let [target, changes] of facts) {
			let visibility = this.visibility.get(target) ?? new TextVisibility()
			visibility.validate(changes)
			commits.push(() => {
				visibility.apply(changes)
				this.visibility.set(target, visibility)
			})
		}
		return () => {
			for (let commit of commits) commit()
			for (let operation of operations) {
				this.clock = Math.max(this.clock, operation.clock)
				if (this.operations.has(operation.id)) continue
				this.operations.set(operation.id, operation)
				this.metadataCache.delete(operation.target)
				let history = this.targets.get(operation.target) ?? []
				history.push(operation)
				this.targets.set(operation.target, history)
				this.created.set(
					operation.target,
					Math.min(
						this.created.get(operation.target) ?? Infinity,
						operation.time,
					),
				)
				this.updated.set(
					operation.target,
					Math.max(this.updated.get(operation.target) ?? 0, operation.time),
				)
				if (operation.kind !== "set") {
					if (operation.kind === "text") {
						for (let atom of operation.insert)
							this.indexAtom(operation.target, atom)
						if (operation.insert.length || operation.remove.length)
							this.textOwners.set(operation.id, operation.target)
					} else this.textOwners.set(operation.id, operation.target)
					this.invalidateText(operation.target)
				} else {
					let fields =
						this.registers.get(operation.target) ?? new Map<string, Operation>()
					let previous = fields.get(operation.field)
					if (!previous || operation.id > previous.id)
						fields.set(operation.field, operation)
					this.registers.set(operation.target, fields)
					this.fieldCache.delete(operation.target)
				}
			}
			if (operations.length) this.stateGeneration++
		}
	}

	create(target: string, kind: Operation["kind"]): Operation {
		this.clock++
		return this.makeOperation(target, kind, this.clock)
	}
	set(target: string, field: string, value: string, restores?: string) {
		let operation = this.makeOperation(target, "set", this.clock + 1)
		operation.field = field
		operation.value = value
		if (restores) operation.restores = restores
		this.apply([operation])
		return operation
	}
	cancel(target: string, original: string) {
		if (!this.canCancel(target, original))
			throw new Error(
				"Text cancellation requires an active accepted contribution above the migration floor",
			)
		let operation = this.makeOperation(target, "cancel", this.clock + 1)
		operation.value = original
		this.apply([operation])
		return operation
	}
	hasTextOperation(target: string, id: string) {
		return this.textOperationTarget(id) === target
	}
	textOperationTarget(id: string) {
		return this.textOwners.get(id)
	}
	textMigrationFloor(target: string) {
		return this.visibility.get(target)?.migrationFloor ?? 0
	}
	canCancel(target: string, id: string) {
		let visibility = this.visibility.get(target)
		return (
			this.hasTextOperation(target, id) &&
			(!visibility || (visibility.canUndo(id) && visibility.active(id)))
		)
	}
	edit(
		target: string,
		next: string,
		atoms = this.visible(target),
		options: { migration?: true } = {},
	) {
		let operation = this.prepareEdit(target, next, atoms, options)
		if (operation) this.apply([operation])
		return operation
	}
	prepareReplacements(
		target: string,
		replacements: readonly TextReplacement[],
		atoms = this.visible(target),
	) {
		this.preparedEdit = undefined
		let current = this.visible(target)
		let previous =
			atoms === current
				? this.text(target)
				: atoms.map(atom => atom.value).join("")
		let end = 0
		let lastStart = -1
		for (let replacement of replacements) {
			if (
				/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
					replacement.text,
				)
			)
				throw new RangeError(
					"Text replacements must contain complete Unicode characters",
				)
			let stop = replacement.start + replacement.remove
			if (
				!Number.isSafeInteger(replacement.start) ||
				!Number.isSafeInteger(replacement.remove) ||
				replacement.remove < 0 ||
				replacement.start < end ||
				replacement.start === lastStart ||
				stop > previous.length
			)
				throw new RangeError(
					"Text replacements must be ordered, disjoint and within their base",
				)
			for (let offset of [replacement.start, stop]) {
				let before = previous.charCodeAt(offset - 1),
					after = previous.charCodeAt(offset)
				if (
					before >= 0xd800 &&
					before <= 0xdbff &&
					after >= 0xdc00 &&
					after <= 0xdfff
				)
					throw new RangeError(
						"Text replacements cannot split a Unicode character",
					)
			}
			end = stop
			lastStart = replacement.start
		}
		let pieces: string[] = []
		let cursor = 0
		for (let replacement of replacements) {
			pieces.push(previous.slice(cursor, replacement.start), replacement.text)
			cursor = replacement.start + replacement.remove
		}
		pieces.push(previous.slice(cursor))
		let next = pieces.join("")
		if (next === previous) return null
		let header = sourceHeader(previous)
		let displacement = 0
		let changesFence = false
		for (let change of replacements) {
			let nextStart = change.start + displacement
			changesFence ||=
				touchesSourceFence(
					previous,
					change.start,
					change.start + change.remove,
				) || touchesSourceFence(next, nextStart, nextStart + change.text.length)
			displacement += change.text.length - change.remove
		}
		if (
			(header &&
				(atoms[0]?.after !== "" ||
					!header[0].endsWith("\n") ||
					replacements.some(change => change.start < header[0].length))) ||
			(!header && sourceHeader(next)) ||
			changesFence
		)
			return this.prepareEdit(target, next, atoms)
		let offsets = sourceOffsets.get(atoms)
		if (previous.length !== atoms.length && !offsets) {
			offsets = new TextIndex(previous)
			sourceOffsets.set(atoms, offsets)
		}
		function position(offset: number) {
			return offsets ? offsets.codePointOffset(offset) : offset
		}
		let operation = this.makeOperation(target, "text", this.clock + 1)
		let cached: PreparedTextEdit["splices"] = []
		for (let replacement of replacements) {
			let start = position(replacement.start),
				stop = position(replacement.start + replacement.remove)
			for (let index = start; index < stop; index++) {
				let atom = atoms[index]
				if (atom) operation.remove.push(atom.id)
			}
			let anchor = atoms[start - 1]?.id ?? ""
			let inserted: string[] = []
			for (let value of replacement.text) {
				let id = `${operation.id}:${String(operation.insert.length).padStart(8, "0")}`
				operation.insert.push({ id, after: anchor, value })
				inserted.push(id)
				anchor = id
			}
			cached.push({ start, remove: stop - start, inserted })
		}
		let raw = sourceViews.get(atoms) ?? atoms
		if (
			current === atoms &&
			raw.length === atoms.length &&
			cached.every(
				change =>
					raw[change.start - 1]?.id === atoms[change.start - 1]?.id &&
					raw[change.start]?.id === atoms[change.start]?.id &&
					raw[change.start + change.remove - 1]?.id ===
						atoms[change.start + change.remove - 1]?.id,
			)
		)
			this.rememberTextEdit(operation, next, atoms, raw, cached)
		return operation
	}

	prepareEdit(
		target: string,
		next: string,
		atoms = this.visible(target),
		options: { migration?: true } = {},
	) {
		this.preparedEdit = undefined
		let previous =
			atoms === this.sourceCache.get(target)
				? this.text(target)
				: atoms.map(atom => atom.value).join("")
		if (previous === next) return null
		let operation = this.makeOperation(target, "text", this.clock + 1)
		let current = this.visible(target)
		let raw = sourceViews.get(atoms) ?? atoms
		let header = sourceHeader(previous)
		let bodyAppend = header
			? atoms[0]?.after === "" &&
				(header[0].length < previous.length || header[0].endsWith("\n"))
			: !previous.startsWith("-") && !previous.startsWith("\uFEFF")
		if (
			atoms.length &&
			current === atoms &&
			bodyAppend &&
			next.startsWith(previous) &&
			!touchesSourceFence(next, previous.length, next.length) &&
			raw.at(-1)?.id === atoms.at(-1)?.id
		) {
			let anchor = atoms.at(-1)?.id ?? ""
			for (let value of Array.from(next.slice(previous.length))) {
				let id = `${operation.id}:${String(operation.insert.length).padStart(8, "0")}`
				operation.insert.push({ id, after: anchor, value })
				anchor = id
			}
			this.rememberTextEdit(operation, next, atoms, raw, [
				{
					start: atoms.length,
					remove: 0,
					inserted: operation.insert.map(atom => atom.id),
				},
			])
			return operation
		}
		if (
			current === atoms &&
			previous.length === atoms.length &&
			raw.length === atoms.length
		) {
			let start = 0,
				previousEnd = previous.length,
				nextEnd = next.length
			while (
				start < previousEnd &&
				start < nextEnd &&
				previous[start] === next[start]
			)
				start++
			while (
				previousEnd > start &&
				nextEnd > start &&
				previous[previousEnd - 1] === next[nextEnd - 1]
			) {
				previousEnd--
				nextEnd--
			}
			let bodyStart = header?.[0].length ?? 0
			let rawAligned =
				raw[start - 1]?.id === atoms[start - 1]?.id &&
				raw[start]?.id === atoms[start]?.id &&
				raw[previousEnd - 1]?.id === atoms[previousEnd - 1]?.id
			let ordinaryBody = header
				? bodyAppend && start >= bodyStart
				: !sourceHeader(next) && bodyAppend
			if (
				ordinaryBody &&
				rawAligned &&
				!touchesSourceFence(next, start, nextEnd) &&
				previousEnd - start + nextEnd - start <= 128
			) {
				let splices = textSplices(
					atoms.slice(start, previousEnd).map(atom => atom.value),
					Array.from(next.slice(start, nextEnd)),
				)
				let cached: PreparedTextEdit["splices"] = []
				for (let splice of splices) {
					let position = start + splice.start
					for (let atom of atoms.slice(position, position + splice.remove))
						operation.remove.push(atom.id)
					let anchor = atoms[position - 1]?.id ?? ""
					let inserted: string[] = []
					for (let value of splice.insert) {
						let id = `${operation.id}:${String(operation.insert.length).padStart(8, "0")}`
						operation.insert.push({ id, after: anchor, value })
						inserted.push(id)
						anchor = id
					}
					cached.push({ start: position, remove: splice.remove, inserted })
				}
				this.rememberTextEdit(operation, next, atoms, raw, cached)
				return operation
			}
		}

		for (let edit of sourceEdits(
			atoms,
			next,
			sourceViews.get(atoms) ?? atoms,
			current,
		)) {
			let before = edit.atoms.map(atom => atom.value)
			let after = Array.from(edit.next)
			let splices = edit.replace
				? [{ start: 0, remove: before.length, insert: after }]
				: textSplices(before, after)
			for (let atom of edit.remove) operation.remove.push(atom.id)
			for (let splice of splices) {
				for (
					let index = splice.start;
					index < splice.start + splice.remove;
					index++
				) {
					let atom = edit.atoms[index]
					if (atom) operation.remove.push(atom.id)
				}
				let anchor =
					edit.atoms[splice.start - 1]?.id ??
					(edit.chain ? operation.insert.at(-1)?.id : edit.anchor) ??
					""
				for (let value of splice.insert) {
					let id = `${operation.id}:${String(operation.insert.length).padStart(8, "0")}`
					operation.insert.push({
						id,
						after: anchor,
						value,
						...(anchor === "" && edit.order ? { order: edit.order } : {}),
						...(anchor === "" && edit.observed
							? { observed: edit.observed }
							: {}),
						...(anchor === "" && edit.ending ? { ending: edit.ending } : {}),
						...(anchor === "" && edit.order && options.migration
							? { migration: options.migration }
							: {}),
						...(anchor === "" && edit.deleted?.length
							? { deleted: edit.deleted }
							: {}),
					})
					anchor = id
				}
			}
		}
		operation.remove = [...new Set(operation.remove)]
		let changesHeader = operation.insert.some(atom => atom.order)
		if (operation.remove.length || changesHeader) {
			let undo = sourceUndo(atoms, operation.remove)
			if (undo.header.length || undo.hidden.length || changesHeader) {
				operation.field = "frontmatter-edit"
				operation.value = Schema.encodeSync(SourceUndoSchema)(undo)
			}
		}
		return operation
	}
	private rememberTextEdit(
		operation: Operation,
		content: string,
		atoms: Atom[],
		raw: Atom[],
		splices: PreparedTextEdit["splices"],
	) {
		this.preparedEdit = {
			id: operation.id,
			target: operation.target,
			generation: this.generation,
			signature: textEditSignature(operation),
			content,
			atoms,
			raw,
			splices,
		}
	}

	inverse(previous: Operation) {
		let operation = this.makeOperation(previous.target, "text", this.clock + 1)
		operation.remove = previous.insert.map(atom => this.liveAtom(atom.id))
		let aliases = new Map<string, string>()
		let ignored = new Set<string>()
		let before = this.visible(previous.target)
		let headerIds = new Set<string>()
		let order: readonly string[] = []
		let ending: Atom["ending"]
		if (previous.field === "frontmatter-edit") {
			let undo = Schema.decodeUnknownSync(SourceUndoSchema)(previous.value)
			ignored = new Set(undo.hidden)
			headerIds = new Set(undo.header)
			order = undo.order
			ending = undo.ending
		}
		let removed = previous.remove
			.filter(id => !ignored.has(id))
			.flatMap(id => {
				let atom = this.atomIndex.get(id)?.atom
				return atom ? [atom] : []
			})
		let fragment = removed.map(atom => atom.value).join("")
		let header =
			removed[0]?.after === "" ? frontmatterBlock(fragment) : undefined
		let restoration = headerIds.size
			? inverseHeader(
					removed.filter(atom => headerIds.has(atom.id)),
					before,
					new Set(operation.remove),
					order,
				)
			: undefined
		if (headerIds.size) for (let id of headerIds) ignored.add(id)
		let anchor = ""
		let restoredAtoms =
			restoration?.atoms ??
			(headerIds.size
				? []
				: removed.slice(0, Array.from(header?.[0] ?? "").length))
		if (restoration && restoredAtoms.at(-1)?.value !== "\n")
			restoredAtoms = [...restoredAtoms, { id: "", after: "", value: "\n" }]
		for (let atom of restoredAtoms) {
			let id = `${operation.id}:${String(operation.insert.length).padStart(8, "0")}`
			operation.insert.push({
				id,
				after: anchor,
				value: atom.value,
				...(anchor === "" && restoration
					? { order: restoration.order, observed: sourceObserved(before) }
					: {}),
				...(anchor === "" && ending ? { ending } : {}),
			})
			anchor = id
			ignored.add(atom.id)
			if (atom.id && previous.remove.includes(atom.id)) aliases.set(atom.id, id)
		}

		for (let id of previous.remove) {
			if (ignored.has(id)) continue
			let atom = this.atomIndex.get(id)?.atom
			if (!atom) continue
			let newId = `${operation.id}:${String(operation.insert.length).padStart(8, "0")}`
			operation.insert.push({
				id: newId,
				after: id,
				value: atom.value,
			})
			aliases.set(id, newId)
		}
		let undo = sourceUndo(before, operation.remove)
		if (
			undo.header.length ||
			undo.hidden.length ||
			operation.insert.some(atom => atom.order)
		) {
			operation.field = "frontmatter-edit"
			operation.value = Schema.encodeSync(SourceUndoSchema)(undo)
		}
		this.apply([operation])
		for (let [previous, current] of aliases)
			this.restored.set(previous, current)
		return operation
	}

	private liveAtom(id: string) {
		while (this.restored.has(id)) id = this.restored.get(id) ?? id
		return id
	}
	visible(target: string, until: number | string = Infinity): Atom[] {
		let cached = until === Infinity ? this.sourceCache.get(target) : undefined
		if (cached) return cached
		let raw = immutableAtoms(this.rawVisible(target, until))
		let atoms = immutableAtoms(
			sourceAtoms(raw, () => this.originalFrames(target, until)),
		)
		if (until === Infinity) this.textCache.set(target, raw)
		sourceViews.set(atoms, raw)
		if (until === Infinity) this.sourceCache.set(target, atoms)
		return atoms
	}
	private originalFrames(target: string, until: number | string) {
		let frames = new Map<string, Atom[]>()
		for (let atoms of this.children.get(target)?.values() ?? []) {
			for (let atom of atoms) {
				let operation = atom.id.slice(0, -9)
				if (
					typeof until === "string"
						? operation > until
						: Number(operation.slice(0, 16)) > until
				)
					continue
				let frame = frames.get(operation) ?? []
				frame.push(atom)
				frames.set(operation, frame)
			}
		}
		return [...frames.values()].map(frame =>
			frame.sort((first, second) =>
				first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
			),
		)
	}
	private rawVisible(
		target: string,
		until: number | string = Infinity,
	): Atom[] {
		let cached = this.textCache.get(target)
		if (until === Infinity && cached) return cached
		if (until === Infinity) {
			let children = this.children.get(target) ?? new Map<string, Atom[]>()
			let visibility = this.visibility.get(target)
			let result: Atom[] = [],
				stack = [...(children.get("") ?? [])].reverse()
			while (stack.length) {
				let atom = stack.pop()
				if (!atom) break
				if (!visibility?.hidden(atom.id)) result.push(atom)
				let descendants = children.get(atom.id) ?? []
				for (let index = descendants.length - 1; index >= 0; index--) {
					let child = descendants[index]
					if (child) stack.push(child)
				}
			}
			this.textCache.set(target, result)
			return result
		}
		this.requireHistory()
		let children = new Map<string, Atom[]>()
		let visibility = new TextVisibility()
		let known = new Set<string>()
		for (let operation of this.targets.get(target) ?? []) {
			if (
				operation.kind === "set" ||
				(typeof until === "string"
					? operation.id > until
					: operation.clock > until)
			)
				continue
			if (operation.kind === "cancel")
				visibility.cancel(operation.id, operation.value)
			else visibility.remove(operation.id, operation.remove)
			for (let atom of operation.insert) {
				if (known.has(atom.id)) continue
				known.add(atom.id)
				let siblings = [...(children.get(atom.after) ?? [])]
				siblings.push(atom)
				children.set(atom.after, siblings)
			}
		}
		for (let siblings of children.values())
			siblings.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
		let result: Atom[] = []
		let stack = [...(children.get("") ?? [])].reverse()
		while (stack.length) {
			let atom = stack.pop()
			if (!atom) break
			if (!visibility.hidden(atom.id)) result.push(atom)
			for (let child of [...(children.get(atom.id) ?? [])].reverse())
				stack.push(child)
		}
		return result
	}
	text(target: string, until: number | string = Infinity) {
		let cached = this.strings.get(target)
		if (until === Infinity && cached !== undefined) {
			let atoms = this.sourceCache.get(target)
			if (atoms && atoms.length !== cached.length && !sourceOffsets.has(atoms))
				sourceOffsets.set(atoms, new TextIndex(cached))
			return cached
		}
		let text = this.visible(target, until)
			.map(atom => atom.value)
			.join("")
		if (until === Infinity) {
			this.strings.set(target, text)
			let atoms = this.sourceCache.get(target)
			if (atoms && atoms.length !== text.length)
				sourceOffsets.set(atoms, new TextIndex(text))
		}
		return text
	}
	fields(target: string, until = "") {
		let cached = this.fieldCache.get(target)
		if (!until && cached) return cached
		if (!until) {
			let fields = Object.fromEntries(
				[...(this.registers.get(target) ?? [])].map(([key, operation]) => [
					key,
					operation.value,
				]),
			)
			this.fieldCache.set(target, fields)
			return fields
		}
		this.requireHistory()
		let fields = new Map<string, Operation>()
		for (let operation of this.targets.get(target) ?? []) {
			if (operation.kind !== "set" || (until && operation.id > until)) continue
			let previous = fields.get(operation.field)
			if (!previous || operation.id > previous.id)
				fields.set(operation.field, operation)
		}
		let materialized = Object.fromEntries(
			[...fields].map(([key, operation]) => [key, operation.value]),
		)
		if (!until) this.fieldCache.set(target, materialized)
		return materialized
	}
	records(type: string) {
		let result: { id: string; fields: Record<string, string> }[] = []
		for (let [id, fields] of this.registers)
			if (fields.get("type")?.value === type)
				result.push({ id, fields: { ...this.fields(id) } })
		return result
	}
	register(target: string, field: string) {
		let operation = this.registers.get(target)?.get(field)
		return operation ? { id: operation.id, value: operation.value } : undefined
	}
	contributor(target: string, field: string) {
		let operation = this.registers.get(target)?.get(field)
		return operation?.restores ?? operation?.id
	}
	metadata(target: string) {
		let cached = this.metadataCache.get(target)
		if (cached) return cached
		let metadata = documentMetadata(this.text(target), this.fields(target))
		this.metadataCache.set(target, metadata)
		return metadata
	}
	documents(room: string, includeDeleted = false): DocumentRecord[] {
		let targets = this.targets.keys()
		let drawings = new Set(
			this.records("whiteboard").map(board => board.fields.document),
		)
		return [...targets]
			.filter(id => {
				let type = this.fields(id).type
				return type === "document" || (includeDeleted && type === "deleted")
			})
			.map(id => {
				let fields = this.fields(id)
				let content = this.text(id)
				let metadata = this.metadata(id)
				let mode = frontmatter(content).values.mode
				let updated = this.updated.get(id) ?? 0
				return {
					id,
					kind:
						fields.whiteboard || drawings.has(id)
							? "whiteboard"
							: mode === "present"
								? "slides"
								: "document",
					title: metadata.title,
					content,
					folder: metadata.path,
					archived: metadata.archived,
					updated,
					room,
					tags: [...metadata.tags],
					pinned: metadata.pinned,
					created: this.created.get(id) ?? 0,
				}
			})
	}
	revision(target: string) {
		let atoms = [...(this.children.get(target)?.values() ?? [])]
			.flat()
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		let visibility =
			this.visibility.get(target)?.checkpoint() ??
			new TextVisibility().checkpoint()
		let fields = [...(this.registers.get(target)?.values() ?? [])].sort(
			(a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0),
		)
		return JSON.stringify([
			atoms.map(atom => [
				atom.id,
				atom.after,
				atom.value,
				atom.order ?? null,
				atom.observed ?? null,
				atom.ending ?? null,
				atom.migration ?? false,
				atom.deleted ?? null,
			]),
			visibility,
			fields.map(field => [field.id, field.field, field.value]),
		])
	}
	hasAtom(target: string, id: string) {
		return this.atomTarget(id) === target
	}
	atomTarget(id: string) {
		return this.atomIndex.get(id)?.target
	}
	checkpoint(): CausalReplicaCheckpoint {
		return {
			format: "alkalye-state-v2",
			clock: this.clock,
			restored: [...this.restored],
			targets: [...this.targets.keys()].map(id => ({
				id,
				created: this.created.get(id) ?? 0,
				updated: this.updated.get(id) ?? 0,
				atoms: [...(this.children.get(id)?.values() ?? [])]
					.flat()
					.map(copyAtom),
				visibility:
					this.visibility.get(id)?.checkpoint() ??
					new TextVisibility().checkpoint(),
				fields: [...(this.registers.get(id)?.values() ?? [])].map(field => ({
					...field,
					insert: field.insert.map(copyAtom),
					remove: [...field.remove],
				})),
			})),
		}
	}
	restore(snapshot: ReplicaCheckpoint) {
		if (!Number.isSafeInteger(snapshot.clock) || snapshot.clock < 0)
			throw new Error("Invalid checkpoint clock")
		if (
			new Set(snapshot.targets.map(target => target.id)).size !==
			snapshot.targets.length
		)
			throw new Error("Duplicate checkpoint target")
		let incoming = snapshot.targets.map(target => {
			if (
				"visibility" in target &&
				(target.visibility.floor > snapshot.clock ||
					[
						...target.visibility.removals.map(([id]) => id),
						...target.visibility.cancels.map(([id]) => id),
					].some(id => Number(id.slice(0, 16)) > snapshot.clock))
			)
				throw new Error("Checkpoint clock precedes its causal facts")
			let visibility = new TextVisibility()
			let previous = this.visibility.get(target.id)
			if (previous) visibility.restore(previous.checkpoint())
			if ("removed" in target) {
				visibility.restore({
					floor: snapshot.clock,
					legacyRemoved: target.removed,
					removals: [],
					cancels: [],
				})
			} else visibility.restore(target.visibility)
			return { target, visibility }
		})
		this.validateSnapshotOwners(snapshot)
		let aliases = this.mergedAliases(snapshot)
		let atoms = new Map<string, { target: string; atom: Atom }>()
		let owners = new Map(this.textOwners)
		let fields: Operation[] = []
		for (let { target, visibility } of incoming) {
			if (
				target.fields.some(
					field =>
						field.kind !== "set" ||
						field.target !== target.id ||
						field.clock > snapshot.clock,
				)
			)
				throw new Error("Invalid checkpoint registers")
			if (
				new Set(target.fields.map(field => field.field)).size !==
				target.fields.length
			)
				throw new Error("Duplicate checkpoint register")
			if (
				new Set(target.atoms.map(atom => atom.id)).size !== target.atoms.length
			)
				throw new Error("Duplicate checkpoint atom identity")
			for (let atom of target.atoms) {
				if (Number(atom.id.slice(0, 16)) > snapshot.clock)
					throw new Error("Checkpoint clock precedes an insertion")
				let known = atoms.get(atom.id) ?? this.atomIndex.get(atom.id)
				if (
					known &&
					(known.target !== target.id ||
						atomIdentity(known.atom) !== atomIdentity(atom))
				)
					throw new Error("Checkpoint atom identity is immutable")
				let owner = atom.id.slice(0, -9)
				if (this.textOwners.has(owner) && !this.atomIndex.has(atom.id))
					throw new Error("Checkpoint insertion identity is immutable")
				let previous = owners.get(owner)
				if (previous && previous !== target.id)
					throw new Error("Text operation belongs to another target")
				owners.set(owner, target.id)
				atoms.set(atom.id, { target: target.id, atom })
			}
			let state = visibility.checkpoint()
			for (let id of [
				...state.removals.map(([id]) => id),
				...state.cancels.map(([id]) => id),
			]) {
				let previous = owners.get(id)
				if (previous && previous !== target.id)
					throw new Error("Text operation belongs to another target")
				owners.set(id, target.id)
			}
			fields.push(...target.fields)
		}
		for (let [id, target] of owners) {
			let previous = this.operations.get(id)
			if (previous && (previous.kind === "set" || previous.target !== target))
				throw new Error("Checkpoint operation identity is ambiguous")
		}
		for (let { target, visibility } of incoming) {
			let state = visibility.checkpoint()
			for (let [, original] of state.cancels)
				if (owners.get(original) !== target.id)
					throw new Error("Invalid checkpoint cancellation target")
			for (let runs of [
				state.legacyRemoved,
				...state.removals.map(([, runs]) => runs),
			])
				for (let id of expandDeletions(runs)) {
					let atom = atoms.get(id) ?? this.atomIndex.get(id)
					if (atom?.target !== target.id)
						throw new Error("Unknown checkpoint deletion")
				}
		}
		this.validateIdentities(fields)
		if (fields.some(field => owners.has(field.id)))
			throw new Error("Checkpoint operation identity is ambiguous")
		this.apply(fields)
		this.clock = Math.max(this.clock, snapshot.clock)
		this.restored = aliases
		for (let { target, visibility } of incoming) {
			if (!this.targets.has(target.id)) this.targets.set(target.id, [])
			this.visibility.set(target.id, visibility)
			for (let atom of target.atoms) this.indexAtom(target.id, copyAtom(atom))
			this.created.set(
				target.id,
				Math.min(target.created, this.created.get(target.id) ?? Infinity),
			)
			this.updated.set(
				target.id,
				Math.max(target.updated, this.updated.get(target.id) ?? 0),
			)
			this.invalidateText(target.id)
			this.fieldCache.delete(target.id)
		}
		this.textOwners = owners
		this.historyLoaded = false
		this.stateGeneration++
	}
	private validateSnapshotOwners(snapshot: ReplicaCheckpoint) {
		for (let target of snapshot.targets) {
			let counts = new Map<string, number>()
			for (let atom of target.atoms) {
				let owner = atom.id.slice(0, -9)
				counts.set(owner, (counts.get(owner) ?? 0) + 1)
			}
			let floor =
				"visibility" in target ? target.visibility.floor : snapshot.clock
			let removals = new Map(
				"visibility" in target ? target.visibility.removals : [],
			)
			let cancels = new Map(
				"visibility" in target ? target.visibility.cancels : [],
			)
			let owners = new Set([
				...counts.keys(),
				...removals.keys(),
				...cancels.keys(),
			])
			let previous = this.visibility.get(target.id)
			for (let owner of owners) {
				let operation = this.operations.get(owner)
				if (!this.textOwners.has(owner) && !operation) continue
				if (
					(this.textOwners.get(owner) ?? operation?.target) !== target.id ||
					operation?.kind === "set" ||
					(previous?.isCancellation(owner) ?? false) !== cancels.has(owner)
				)
					throw new Error("Checkpoint operation identity is immutable")
				if ((counts.get(owner) ?? 0) !== (this.ownedAtomCounts.get(owner) ?? 0))
					throw new Error("Checkpoint insertion identity is immutable")
				if (
					Number(owner.slice(0, 16)) >
					Math.max(previous?.migrationFloor ?? 0, floor)
				) {
					let removed = removals.get(owner) ?? []
					if (!(
						previous?.matchesRemoval(owner, expandDeletions(removed)) ??
						!removed.length
					))
						throw new Error("Checkpoint removal identity is immutable")
				}
			}
		}
	}
	private mergedAliases(snapshot: ReplicaCheckpoint) {
		let aliases = new Map(this.restored)
		let atoms = new Map<string, string>()
		for (let [id, entry] of this.atomIndex) atoms.set(id, entry.target)
		for (let target of snapshot.targets)
			for (let atom of target.atoms) atoms.set(atom.id, target.id)
		let incoming = new Set<string>()
		for (let [previous, current] of snapshot.restored) {
			if (incoming.has(previous))
				throw new Error("Duplicate restored atom identity")
			incoming.add(previous)
			if (!atoms.has(previous) || atoms.get(previous) !== atoms.get(current))
				throw new Error("Unknown or foreign restored atom identity")
			if (Number(current.slice(0, 16)) <= Number(previous.slice(0, 16)))
				throw new Error("Restored atom identities must advance their clock")
			let known = aliases.get(previous)
			aliases.set(previous, known && known > current ? known : current)
		}
		let checked = new Set<string>()
		for (let previous of aliases.keys()) {
			let path = new Set<string>(),
				next = previous
			while (next && !checked.has(next)) {
				if (path.has(next)) throw new Error("Restored atom identity cycle")
				path.add(next)
				next = aliases.get(next) ?? ""
			}
			for (let id of path) checked.add(id)
		}
		return aliases
	}

	private invalidateText(target: string) {
		this.textCache.delete(target)
		this.sourceCache.delete(target)
		this.strings.delete(target)
		this.metadataCache.delete(target)
	}
	private validateIdentities(operations: Operation[]) {
		let known = new Map<string, Operation>()
		let atoms = new Map<string, { target: string; atom: Atom }>()
		for (let operation of operations) {
			let previous =
				known.get(operation.id) ?? this.operations.get(operation.id)
			if (previous && JSON.stringify(previous) !== JSON.stringify(operation))
				throw new Error("Operation identity is immutable")
			known.set(operation.id, operation)
			let owner = this.textOwners.get(operation.id)
			if (
				owner &&
				(owner !== operation.target ||
					operation.kind === "set" ||
					(this.visibility.get(owner)?.isCancellation(operation.id) ??
						false) !==
						(operation.kind === "cancel"))
			)
				throw new Error("Operation identity is immutable")
			if (owner && operation.kind === "text") {
				if (
					operation.insert.length !==
					(this.ownedAtomCounts.get(operation.id) ?? 0)
				)
					throw new Error("Insertion identity is immutable")
				let visibility = this.visibility.get(owner)
				if (
					Number(operation.id.slice(0, 16)) >
						(visibility?.migrationFloor ?? 0) &&
					!(
						visibility?.matchesRemoval(operation.id, operation.remove) ??
						!operation.remove.length
					)
				)
					throw new Error("Removal identity is immutable")
			}
			for (let atom of operation.insert) {
				if (owner && !this.atomIndex.has(atom.id))
					throw new Error("Insertion identity is immutable")
				let previous = atoms.get(atom.id) ?? this.atomIndex.get(atom.id)
				if (
					previous &&
					(previous.target !== operation.target ||
						atomIdentity(previous.atom) !== atomIdentity(atom))
				)
					throw new Error("Atom identity is immutable")
				atoms.set(atom.id, { target: operation.target, atom })
			}
		}
	}

	private makeOperation(
		target: string,
		kind: Operation["kind"],
		clock: number,
	): Operation {
		return {
			id: `${String(clock).padStart(16, "0")}:${this.actor}`,
			clock,
			actor: this.actor,
			time: Date.now(),
			author: this.author,
			target,
			kind,
			insert: [],
			remove: [],
			field: "",
			value: "",
		}
	}
	private indexAtom(target: string, atom: Atom) {
		if (this.atomIndex.has(atom.id)) return
		freezeTextAtom(atom)
		this.atomIndex.set(atom.id, { target, atom })
		let owner = atom.id.slice(0, -9)
		this.ownedAtomCounts.set(owner, (this.ownedAtomCounts.get(owner) ?? 0) + 1)
		let children = this.children.get(target) ?? new Map<string, Atom[]>()
		let siblings = [...(children.get(atom.after) ?? [])]
		let index = siblings.findIndex(sibling => sibling.id < atom.id)
		siblings.splice(index < 0 ? siblings.length : index, 0, atom)
		children.set(atom.after, siblings)
		this.children.set(target, children)
	}
	private requireHistory() {
		if (!this.historyLoaded)
			throw new Error("Load history before opening a past version")
	}
}

function atomIdentity(atom: Atom) {
	return JSON.stringify([
		atom.after,
		atom.value,
		atom.order ?? null,
		atom.observed ?? null,
		atom.ending ?? null,
		atom.migration ?? false,
		atom.deleted ?? null,
	])
}

function copyAtom(atom: Atom): Atom {
	return {
		...atom,
		...(atom.order ? { order: [...atom.order] } : {}),
		...(atom.observed ? { observed: [...atom.observed] } : {}),
		...(atom.deleted ? { deleted: [...atom.deleted] } : {}),
	}
}

function freezeTextAtom(atom: Atom) {
	if (Object.isFrozen(atom)) return
	if (atom.order) Object.freeze(atom.order)
	if (atom.observed) Object.freeze(atom.observed)
	if (atom.deleted) Object.freeze(atom.deleted)
	Object.freeze(atom)
}
function freezeFact(operation: Operation) {
	if (Object.isFrozen(operation)) return
	for (let atom of operation.insert) freezeTextAtom(atom)
	Object.freeze(operation.insert)
	Object.freeze(operation.remove)
	Object.freeze(operation)
}

function textEditSignature(operation: Operation) {
	return JSON.stringify([
		operation.target,
		operation.kind,
		operation.field,
		operation.value,
		operation.insert.map(atomIdentity),
		operation.remove,
	])
}

function touchesSourceFence(source: string, start: number, end: number) {
	let first = source.lastIndexOf("\n", start - 1) + 1
	let last = source.indexOf("\n", end)
	return /^---[ \t]*\r?$/m.test(
		source.slice(first, last < 0 ? source.length : last),
	)
}

function sourceHeader(source: string) {
	return source.startsWith("---") || source.startsWith("\uFEFF---")
		? frontmatterBlock(source)
		: undefined
}
