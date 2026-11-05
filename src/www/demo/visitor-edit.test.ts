import { describe, expect, it } from "vitest"
import { applyVisitorEdit, diffVisitorEdit } from "./visitor-edit"

describe("visitor edits", () => {
	it("keeps a visitor's line when the script adds text after it", () => {
		let scripted = "# Title\n\nFirst paragraph.\n"
		let edit = diffVisitorEdit(
			scripted,
			"# Title\n\nHello from me\n\nFirst paragraph.\n",
		)
		expect(edit).not.toBeNull()
		if (!edit) return

		let later = applyVisitorEdit(scripted + "\nSecond paragraph.\n", edit)
		expect(later.content).toBe(
			"# Title\n\nHello from me\n\nFirst paragraph.\n\nSecond paragraph.\n",
		)
	})

	it("keeps a visitor's edit when the script adds frontmatter before it", () => {
		let scripted = "# Title\n\nFirst paragraph.\n"
		let edit = diffVisitorEdit(scripted, "# My title\n\nFirst paragraph.\n")
		if (!edit) throw new Error("expected an edit")

		let later = applyVisitorEdit("---\nmode: present\n---\n\n" + scripted, edit)
		expect(later.content).toBe(
			"---\nmode: present\n---\n\n# My title\n\nFirst paragraph.\n",
		)
	})

	it("moves scripted cursors past the visitor's text", () => {
		let edit = diffVisitorEdit("ab", "aXYZb")
		if (!edit) throw new Error("expected an edit")
		let { mapPosition } = applyVisitorEdit("ab", edit)
		expect(mapPosition(0)).toBe(0)
		expect(mapPosition(2)).toBe(5)
	})

	it("adds the visitor's text at the end once its place is gone", () => {
		let edit = diffVisitorEdit("old words here", "old words here!")
		if (!edit) throw new Error("expected an edit")
		expect(applyVisitorEdit("something else", edit).content).toBe(
			"something else!",
		)
	})

	it("finds no edit when nothing changed", () => {
		expect(diffVisitorEdit("same", "same")).toBeNull()
	})
})
