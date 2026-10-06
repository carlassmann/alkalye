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
import { textSplices } from "./text-splices"

let sourceViews = new WeakMap<Atom[], Atom[]>()

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
	constructor(
		public actor: string,
		public author = "Writer",
	) {}
	get generation() {
		return this.stateGeneration
	}
	apply(input: Operation[]) {
		this.prepare(input)()
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
	prepareEdit(
		target: string,
		next: string,
		atoms = this.visible(target),
		options: { migration?: true } = {},
	) {
		let previous = atoms.map(atom => atom.value).join("")
		if (previous === next) return null
		let operation = this.makeOperation(target, "text", this.clock + 1)
		let current = this.visible(target)
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
			operation.remove.push(...edit.remove.map(atom => atom.id))
			for (let splice of splices) {
				operation.remove.push(
					...edit.atoms
						.slice(splice.start, splice.start + splice.remove)
						.map(atom => atom.id),
				)
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
		let undo = sourceUndo(atoms, operation.remove)
		if (
			undo.header.length ||
			undo.hidden.length ||
			operation.insert.some(atom => atom.order)
		) {
			operation.field = "frontmatter-edit"
			operation.value = Schema.encodeSync(SourceUndoSchema)(undo)
		}
		return operation
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
		let raw = this.rawVisible(target, until)
		let atoms = sourceAtoms(raw, () => this.originalFrames(target, until))
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
				let siblings = children.get(atom.after) ?? []
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
		if (until === Infinity && cached !== undefined) return cached
		let text = this.visible(target, until)
			.map(atom => atom.value)
			.join("")
		if (until === Infinity) this.strings.set(target, text)
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
		this.atomIndex.set(atom.id, { target, atom })
		let owner = atom.id.slice(0, -9)
		this.ownedAtomCounts.set(owner, (this.ownedAtomCounts.get(owner) ?? 0) + 1)
		let children = this.children.get(target) ?? new Map<string, Atom[]>()
		let siblings = children.get(atom.after) ?? []
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
