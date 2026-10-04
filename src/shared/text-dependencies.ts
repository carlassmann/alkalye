import * as Effect from "effect/Effect"
import * as Graph from "effect/Graph"
import * as Option from "effect/Option"
import type { Replica } from "./crdt"
import type { Atom, Operation } from "./model"

interface MissingDependency {
	target: string
	atom: string
	kind: "atom" | "contribution"
}
export interface TextRejection extends MissingDependency {
	operation: Operation
	reason: "AnchorCycle" | "ForeignTarget"
	message: string
}

export function partitionTextOperations(
	replica: Pick<Replica, "atomTarget" | "textOperationTarget">,
	changes: readonly Operation[],
) {
	return Effect.sync(() => {
		let inserted = new Map<string, { atom: Atom; change: Operation }>()
		for (let change of changes)
			if (change.kind === "text")
				for (let atom of change.insert) inserted.set(atom.id, { atom, change })
		let contributions = new Map(
			changes
				.filter(
					change =>
						change.kind === "cancel" ||
						(change.kind === "text" &&
							(change.insert.length || change.remove.length)),
				)
				.map(change => [change.id, change]),
		)
		let cyclic = cyclicOperations(inserted)
		let rejected = new Map<string, TextRejection>()
		for (let change of changes)
			if (cyclic.has(change.id))
				rejected.set(change.id, {
					operation: change,
					target: change.target,
					atom: change.id,
					kind: "atom",
					reason: "AnchorCycle",
					message: "Text insertions cannot contain an anchor cycle",
				})
		let missing: MissingDependency[] = [],
			blocked = new Set<Graph.NodeIndex>()
		let dependencies = Graph.directed<Operation, undefined>(mutable => {
			let nodes = new Map<string, Graph.NodeIndex>(),
				edges = new Set<string>()
			for (let change of changes)
				if (!nodes.has(change.id))
					nodes.set(change.id, Graph.addNode(mutable, change))
			for (let change of changes) {
				let node = nodes.get(change.id)
				if (cyclic.has(change.id) && node !== undefined) blocked.add(node)
				if (change.kind === "cancel") {
					let owner = contributions.get(change.value)
					requireDependency(
						change,
						change.value,
						"contribution",
						replica.textOperationTarget(change.value),
						owner,
					)
				} else if (change.kind === "text") {
					for (let atom of change.insert)
						if (atom.after) requireAtom(change, atom.after)
					for (let id of change.remove) requireAtom(change, id)
				}
			}
			function requireAtom(change: Operation, id: string) {
				requireDependency(
					change,
					id,
					"atom",
					replica.atomTarget(id),
					inserted.get(id)?.change,
				)
			}
			function requireDependency(
				change: Operation,
				atom: string,
				kind: MissingDependency["kind"],
				acceptedTarget: string | undefined,
				owner: Operation | undefined,
			) {
				let to = nodes.get(change.id)
				if (to === undefined) return
				let target = acceptedTarget ?? owner?.target
				if (target !== undefined && target !== change.target) {
					if (!rejected.has(change.id))
						rejected.set(change.id, {
							operation: change,
							target: change.target,
							atom,
							kind,
							reason: "ForeignTarget",
							message: "Text dependencies must belong to the same target",
						})
					blocked.add(to)
				} else if (acceptedTarget === change.target) return
				else if (!owner) {
					if (!blocked.has(to))
						missing.push({ target: change.target, atom, kind })
					blocked.add(to)
				} else {
					let from = nodes.get(owner.id)
					if (from !== undefined && from !== to) {
						let edge = from + ":" + to
						if (!edges.has(edge)) {
							Graph.addEdge(mutable, from, to, undefined)
							edges.add(edge)
						}
					}
				}
			}
		})
		let deferredIds = new Set(
			Array.from(
				Graph.values(Graph.bfs(dependencies, { start: [...blocked] })),
				change => change.id,
			),
		)
		return {
			ready: changes.filter(change => !deferredIds.has(change.id)),
			deferred: changes.filter(
				change => deferredIds.has(change.id) && !rejected.has(change.id),
			),
			missing,
			rejected: [...rejected.values()],
		}
	})
}

function cyclicOperations(
	inserted: Map<string, { atom: Atom; change: Operation }>,
) {
	let result = new Set<string>(),
		unordered = false
	for (let [id, { atom }] of inserted)
		if (inserted.has(atom.after) && atom.after >= id) {
			unordered = true
			break
		}
	// Strictly decreasing identities cannot form a cycle.
	if (!unordered) return result
	let anchors = Graph.directed<{ atom: Atom; change: Operation }, undefined>(
		mutable => {
			let nodes = new Map<string, Graph.NodeIndex>()
			for (let [id, entry] of inserted)
				nodes.set(id, Graph.addNode(mutable, entry))
			for (let [id, { atom }] of inserted) {
				let from = nodes.get(id),
					to = nodes.get(atom.after)
				if (from !== undefined && to !== undefined)
					Graph.addEdge(mutable, from, to, undefined)
			}
		},
	)
	for (let component of Graph.stronglyConnectedComponents(anchors))
		for (let node of component) {
			let entry = Graph.getNode(anchors, node)
			if (
				Option.isSome(entry) &&
				(component.length > 1 || entry.value.atom.after === entry.value.atom.id)
			)
				result.add(entry.value.change.id)
		}
	return result
}
