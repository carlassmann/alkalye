import type { Replica } from "./crdt"
import type { Operation } from "./model"

export function editGroups(operations: Operation[], pause = 500) {
	let groups: Operation[][] = []
	for (let operation of operations) {
		let previous = groups.at(-1)?.at(-1)
		if (
			previous &&
			previous.actor === operation.actor &&
			operation.time - previous.time >= 0 &&
			operation.time - previous.time < pause
		)
			groups.at(-1)?.push(operation)
		else groups.push([operation])
	}
	return groups
}

export class EditHistory {
	private undo = new Map<string, Operation[][]>()
	private redo = new Map<string, Operation[][]>()
	record(key: string, operation: Operation) {
		let groups = this.undo.get(key) ?? []
		let previous = groups.at(-1)?.at(-1)
		if (previous && operation.time - previous.time < 500)
			groups.at(-1)?.push(operation)
		else groups.push([operation])
		this.undo.set(key, groups)
		this.redo.delete(key)
	}
	revert(key: string, replica: Replica, redo = false) {
		let source = redo ? this.redo : this.undo
		let destination = redo ? this.undo : this.redo
		let group = source.get(key)?.pop()
		if (!group) return []
		let inverses = [...group]
			.reverse()
			.map(operation => replica.inverse(operation))
		let groups = destination.get(key) ?? []
		groups.push(inverses)
		destination.set(key, groups)
		return inverses
	}
}
