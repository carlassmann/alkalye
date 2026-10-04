import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"
import { Replica } from "../../src/shared/crdt"
import { validateTextCausality } from "../../src/shared/document-causality"
import {
	AtomSchema,
	IdentifierSchema,
	parseOperation,
} from "../../src/shared/model"
import type { Operation } from "../../src/shared/model"
import { TextVisibility } from "./visibility"

let ContributionId = Schema.String.check(
	Schema.isPattern(/^\d{16}:[\w-]{1,100}$/),
)
let ContributionSchema = Schema.Struct({
	id: ContributionId,
	insert: Schema.Array(IdentifierSchema),
	remove: Schema.Array(IdentifierSchema),
	cancel: Schema.optional(ContributionId),
})
let SnapshotSchema = Schema.Struct({
	format: Schema.Literal("causal-text-experiment-v1"),
	document: IdentifierSchema,
	clock: Schema.Natural.check(
		Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
	),
	atoms: Schema.Array(AtomSchema),
	contributions: Schema.Array(ContributionSchema),
})
type Snapshot = typeof SnapshotSchema.Type

export class CausalText {
	private state: Snapshot
	constructor(document: string) {
		this.state = {
			format: "causal-text-experiment-v1",
			document,
			clock: 0,
			atoms: [],
			contributions: [],
		}
	}
	append(input: Operation, cancel?: string) {
		let operation = parseOperation(input)
		if (operation.target !== this.state.document || operation.kind !== "text")
			throw new Error("Contribution must belong to this document's text")
		let contribution = Schema.decodeUnknownSync(ContributionSchema)({
			id: operation.id,
			insert: operation.insert.map(atom => atom.id),
			remove: operation.remove,
			...(cancel ? { cancel } : {}),
		})
		let previous = this.state.contributions.find(
			value => value.id === operation.id,
		)
		if (previous) {
			let atoms = this.state.atoms.filter(atom =>
				previous.insert.includes(atom.id),
			)
			if (
				JSON.stringify(previous) !== JSON.stringify(contribution) ||
				JSON.stringify(atoms) !== JSON.stringify(operation.insert)
			)
				throw new Error("Contribution identity is immutable")
			return
		}
		if (cancel) {
			let original = this.state.contributions.find(value => value.id === cancel)
			if (
				!original ||
				contributionClock(original.id) >= operation.clock ||
				operation.insert.length ||
				operation.remove.length
			)
				throw new Error(
					"Cancellation must reference an earlier accepted contribution",
				)
		}
		let known = new Set(this.state.atoms.map(atom => atom.id))
		Effect.runSync(
			validateTextCausality(
				{
					atomTarget: id => (known.has(id) ? this.state.document : undefined),
					textOperationTarget: id =>
						this.state.contributions.some(
							value =>
								value.id === id &&
								Boolean(
									value.insert.length || value.remove.length || value.cancel,
								),
						)
							? this.state.document
							: undefined,
				},
				this.state.document,
				[operation],
			),
		)
		this.state = {
			...this.state,
			clock: Math.max(this.state.clock, operation.clock),
			atoms: [...this.state.atoms, ...operation.insert],
			contributions: [...this.state.contributions, contribution],
		}
	}
	checkpoint() {
		return Schema.decodeUnknownSync(SnapshotSchema)(structuredClone(this.state))
	}
	restore(input: unknown) {
		let state = Schema.decodeUnknownSync(SnapshotSchema)(input)
		if (state.document !== this.state.document)
			throw new Error("Snapshot belongs to another document")
		let contributions = new Map(
			state.contributions.map(value => [value.id, value]),
		)
		let atoms = new Set(state.atoms.map(atom => atom.id))
		if (
			contributions.size !== state.contributions.length ||
			atoms.size !== state.atoms.length
		)
			throw new Error("Duplicate snapshot identity")
		let owned = new Set<string>()
		for (let contribution of state.contributions) {
			if (
				contribution.cancel &&
				(!contributions.has(contribution.cancel) ||
					contributionClock(contribution.cancel) >=
						contributionClock(contribution.id) ||
					contribution.insert.length ||
					contribution.remove.length)
			)
				throw new Error("Invalid snapshot cancellation")
			for (let id of contribution.insert) {
				if (
					!atoms.has(id) ||
					owned.has(id) ||
					!id.startsWith(contribution.id + ":")
				)
					throw new Error("Invalid insertion ownership")
				owned.add(id)
			}
			for (let id of contribution.remove)
				if (!atoms.has(id)) throw new Error("Invalid deletion ownership")
		}
		if (owned.size !== atoms.size)
			throw new Error("Snapshot omits insertion provenance")
		let indexed = new Map(state.atoms.map(atom => [atom.id, atom]))
		let operations = state.contributions.map(contribution =>
			parseOperation({
				id: contribution.id,
				actor: contribution.id.split(":")[1],
				clock: Number(contribution.id.split(":")[0]),
				time: 0,
				author: "Snapshot",
				target: state.document,
				kind: "text",
				field: "",
				value: "",
				insert: contribution.insert.flatMap(id => {
					let atom = indexed.get(id)
					return atom ? [atom] : []
				}),
				remove: contribution.remove,
			}),
		)
		if (operations.some(operation => operation.clock > state.clock))
			throw new Error("Snapshot clock precedes its contributions")
		Effect.runSync(
			validateTextCausality(
				new Replica("validation"),
				state.document,
				operations,
			),
		)
		this.state = structuredClone(state)
	}
	materialize(actor = "experiment") {
		let cancelled = new Set<string>()
		let removed = new Set<string>()
		for (let contribution of [...this.state.contributions].sort((a, b) =>
			a.id > b.id ? -1 : a.id < b.id ? 1 : 0,
		)) {
			if (cancelled.has(contribution.id)) {
				for (let id of contribution.insert) removed.add(id)
			} else {
				if (contribution.cancel) cancelled.add(contribution.cancel)
				for (let id of contribution.remove) removed.add(id)
			}
		}
		return this.project(removed, actor)
	}
	materializeWithVisibility(actor = "experiment") {
		let visibility = new TextVisibility()
		for (let contribution of this.state.contributions) {
			if (contribution.cancel)
				visibility.cancel(contribution.id, contribution.cancel)
			else visibility.remove(contribution.id, contribution.remove)
		}
		return this.project(
			new Set(
				this.state.atoms
					.filter(atom => visibility.hidden(atom.id))
					.map(atom => atom.id),
			),
			actor,
		)
	}
	private project(removed: ReadonlySet<string>, actor: string) {
		let replica = new Replica(actor)
		replica.restore({
			format: "alkalye-state-v1",
			clock: this.state.clock,
			restored: [],
			targets: [
				{
					id: this.state.document,
					created: 0,
					updated: 0,
					atoms: [...this.state.atoms],
					removed: [...removed],
					fields: [],
				},
			],
		})
		return replica
	}
}

function contributionClock(id: string) {
	return Number(id.split(":")[0])
}
