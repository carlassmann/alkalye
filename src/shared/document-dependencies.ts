import * as Effect from "effect/Effect"
import * as Graph from "effect/Graph"
import type { Replica } from "./crdt"
import type { DocumentAction } from "./document-actions"
import { parseOperation } from "./model"
import { CausalDependencyMissing } from "./document-errors"

export function partitionDocumentActions(
	accepted: Pick<Replica, "register" | "atomTarget" | "textOperationTarget">,
	actions: readonly DocumentAction[],
	roots: readonly string[],
) {
	return Effect.sync(() => {
		let nodes = new Map<string, Graph.NodeIndex>()
		let atoms = new Map<string, string>()
		let contributions = new Map<string, string>()
		let bindings = new Map<string, string>()
		let registers = new Map<string, string>()
		let lastSet = new Map<string, string>()
		let missing: CausalDependencyMissing | undefined
		let graph = Graph.directed<DocumentAction, undefined>(mutable => {
			for (let action of actions) {
				let operations = action.changes.map(parseOperation)
				let ownAtoms = new Set(
					operations.flatMap(change => change.insert.map(atom => atom.id)),
				)
				let ownContributions = new Set(
					operations
						.filter(change => change.kind !== "set")
						.map(change => change.id),
				)
				let node = Graph.addNode(mutable, action)
				nodes.set(action.id, node)
				let owners = new Set<string>()
				if (action.undoOf) depend(action.undoOf)
				for (let guard of action.accessGuards)
					depend(registers.get(guard.observed))
				for (let change of operations) {
					if (change.restores) depend(registers.get(change.restores))
					if (change.kind === "set")
						depend(lastSet.get(JSON.stringify([change.target, change.field])))
					if (!accepted.register(change.target, "document"))
						depend(bindings.get(change.target))
					if (change.kind === "cancel") {
						if (
							!accepted.textOperationTarget(change.value) &&
							!ownContributions.has(change.value)
						)
							requireDependency(
								action.document,
								contributions.get(change.value),
								change.target,
								change.value,
							)
					} else if (change.kind === "text") {
						for (let atom of change.insert)
							if (
								atom.after &&
								!accepted.atomTarget(atom.after) &&
								!ownAtoms.has(atom.after)
							)
								requireDependency(
									action.document,
									atoms.get(atom.after),
									change.target,
									atom.after,
								)
						for (let atom of change.remove)
							if (!accepted.atomTarget(atom) && !ownAtoms.has(atom))
								requireDependency(
									action.document,
									atoms.get(atom),
									change.target,
									atom,
								)
					}
				}
				for (let owner of owners) {
					let previous = nodes.get(owner)
					if (previous !== undefined && previous !== node)
						Graph.addEdge(mutable, previous, node, undefined)
				}
				for (let change of operations) {
					if (change.kind === "set") {
						registers.set(change.id, action.id)
						lastSet.set(
							JSON.stringify([change.target, change.field]),
							action.id,
						)
						if (change.field === "document" && !bindings.has(change.target))
							bindings.set(change.target, action.id)
					} else {
						contributions.set(change.id, action.id)
						if (change.kind === "text")
							for (let atom of change.insert) atoms.set(atom.id, action.id)
					}
				}
				function depend(owner: string | undefined) {
					if (owner !== undefined) owners.add(owner)
				}
				function requireDependency(
					document: string,
					owner: string | undefined,
					target: string,
					atom: string,
				) {
					if (owner === undefined)
						missing =
							missing ??
							new CausalDependencyMissing({
								document,
								target,
								atom,
								message: "An action depends on a missing source contribution",
							})
					else depend(owner)
				}
			}
		})
		let start = roots.flatMap(id => {
			let node = nodes.get(id)
			return node === undefined ? [] : [node]
		})
		let blocked = new Set(
			Array.from(
				Graph.values(Graph.bfs(graph, { start })),
				action => action.id,
			),
		)
		return {
			missing,
			ready: actions.filter(action => !blocked.has(action.id)),
			blocked: actions.filter(action => blocked.has(action.id)),
		}
	}).pipe(
		Effect.flatMap(result =>
			result.missing
				? Effect.fail(result.missing)
				: Effect.succeed({ ready: result.ready, blocked: result.blocked }),
		),
	)
}
