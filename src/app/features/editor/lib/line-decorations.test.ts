import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { afterEach, describe, expect, it } from "vitest"
import { lineDecorations } from "./line-decorations"

let views: EditorView[] = []

afterEach(() => {
	for (let view of views) view.destroy()
	views = []
	document.body.innerHTML = ""
})

describe("line decorations - task lines", () => {
	it("treats a task as done only when its marker is checked", () => {
		expect(lineClass("- [x] done")).toContain("cm-task-done-line")
	})

	it("keeps an unchecked task open even when its text contains [x]", () => {
		let className = lineClass("- [ ] fix [x] thing")
		expect(className).toContain("cm-task-line")
		expect(className).not.toContain("cm-task-done-line")
	})
})

function lineClass(doc: string): string {
	let parent = document.createElement("div")
	document.body.appendChild(parent)
	let view = new EditorView({
		state: EditorState.create({
			doc,
			extensions: [
				markdown({ base: markdownLanguage, addKeymap: false }),
				lineDecorations,
			],
		}),
		parent,
	})
	views.push(view)
	return view.dom.querySelector(".cm-line")?.className ?? ""
}
