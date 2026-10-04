import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { selectDocumentUndo } from "../src/shared/document-undo"
import type { UndoEntry } from "../src/shared/document-undo"

function entry(
	id: string,
	order: number,
	undoOf?: string,
	subject = "owner",
): UndoEntry {
	return { id, order, undoOf, subject, local: true, active: true, birth: false }
}
function select(entries: UndoEntry[], redo = false) {
	return Effect.runSync(selectDocumentUndo(entries, "owner", redo))
}

test("whole-document undo and redo derive a durable branch from chronological actions", () => {
	let actions = [entry("A", 1), entry("B", 2)]
	expect(select(actions).tip.id).toBe("B")
	actions.push(entry("UB", 3, "B"))
	expect(select(actions).tip.id).toBe("A")
	actions.push(entry("UA", 4, "A"))
	expect(select(actions, true).tip.id).toBe("UA")
	actions.push(entry("RA", 5, "UA"))
	expect(select(actions, true).tip.id).toBe("UB")
	actions.push(entry("RB", 6, "UB"))
	expect(select(actions).tip.id).toBe("RB")
	expect(select(structuredClone(actions)).tip.id).toBe("RB")
})
test("normal actions invalidate older redo branches permanently through later undos", () => {
	let actions = [entry("A", 1), entry("UA", 2, "A"), entry("B", 3)]
	expect(() => select(actions, true)).toThrow("Nothing to redo")
	actions.push(entry("UB", 4, "B"))
	expect(select(actions, true).tip.id).toBe("UB")
	actions.push(entry("RB", 5, "UB"))
	expect(() => select(actions, true)).toThrow("Nothing to redo")
})
test("birth, rejected work and peer-owned chain tips cannot become undo targets", () => {
	let actions = [
		{ ...entry("birth", 0), birth: true },
		entry("A", 1),
		entry("B", 2),
		{ ...entry("UB", 3, "B"), active: false },
	]
	expect(select(actions).tip.id).toBe("B")
	actions.push({ ...entry("peer-UB", 4, "B", "peer"), local: false })
	expect(select(actions).tip.id).toBe("A")
	expect(() => select(actions, true)).toThrow("Nothing to redo")
	actions.push({ ...entry("peer-RB", 5, "peer-UB", "peer"), local: false })
	expect(select(actions).tip.id).toBe("A")
})
test("same-account compensation on another device extends the chain without an extra round trip", () => {
	let actions = [entry("A", 1), { ...entry("UA", 2, "A"), local: false }]
	expect(() => select(actions)).toThrow("Nothing to undo")
	expect(select(actions, true).tip.id).toBe("UA")
	actions.push(entry("RA", 3, "UA"))
	expect(select(actions).tip.id).toBe("RA")
})
test("cycles, forks and duplicated identities fail explicitly instead of selecting an arbitrary branch", () => {
	expect(() => select([entry("A", 1), entry("A", 2)])).toThrow("duplicate")
	expect(() => select([entry("A", 1, "B"), entry("B", 2, "A")])).toThrow(
		"cycle",
	)
	expect(() =>
		select([entry("A", 1), entry("UA", 2, "A"), entry("other-UA", 3, "A")]),
	).toThrow("ambiguous")
})
test("a forked older chain cannot block a clean newer undo", () => {
	let actions = [
		entry("A", 1),
		entry("UA", 2, "A"),
		entry("other-UA", 3, "A"),
		entry("B", 4),
	]
	expect(select(actions).tip.id).toBe("B")
})
test("an ineligible root keeps its chain intact and permits older eligible undo", () => {
	let actions = [entry("A", 1), { ...entry("B", 2), eligible: false }]
	expect(select(actions).tip.id).toBe("A")
	actions.push(entry("UB", 3, "B"))
	expect(() => select(actions, true)).toThrow("Nothing to redo")
})
test("an ineligible normal action still invalidates an older redo branch", () => {
	let actions = [
		entry("A", 1),
		entry("UA", 2, "A"),
		{ ...entry("B", 3), eligible: false },
	]
	expect(() => select(actions, true)).toThrow("Nothing to redo")
})
