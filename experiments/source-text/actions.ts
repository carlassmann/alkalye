import {
	frontmatterBlock,
	withFrontmatter,
	type FrontmatterValue,
} from "../../src/shared/markdown"
import { SourceReplica, type SourceChange } from "./replica"

export function setSourceField(
	source: SourceReplica,
	key: string,
	value: FrontmatterValue,
) {
	let changes: SourceChange[] = []
	if (!frontmatterBlock(source.text())) changes.push(createHeader(source))
	let previous = source.text(),
		next = withFrontmatter(previous, { [key]: value })
	let open = source.visible().find(atom => atom.value === "-")
	if (!open) throw new Error("Missing source header")
	let change = source.edit(next, source.visible(), open.id + ":" + key)
	if (change) changes.push(change)
	return changes
}
function createHeader(source: SourceReplica): SourceChange {
	let generations = source.snapshot().atoms.flatMap(atom => {
		let match = atom.id.match(/^~header\/(\d+)\/open\/0$/)
		return match ? [Number(match[1])] : []
	})
	let generation = Math.max(0, ...generations) + 1
	let opening = "~header/" + generation + "/open/",
		closing = "!header/" + generation + "/close/"
	let insert: SourceChange["insert"][number][] = [],
		anchor = ""
	let first = source.visible()[0]
	if (first?.value === "\uFEFF") anchor = first.id
	for (let [index, value] of Array.from("---\n").entries()) {
		let id = opening + index
		insert.push({ id, after: anchor, value })
		anchor = id
	}
	for (let [index, value] of Array.from("---\n").entries()) {
		let id = closing + index
		insert.push({ id, after: anchor, value })
		anchor = id
	}
	let clock = source.clock + 1,
		id = String(clock).padStart(16, "0") + ":" + source.actor
	let change = { id, clock, insert, remove: [] }
	source.apply(change)
	return change
}
