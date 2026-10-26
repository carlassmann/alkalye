import { selectNextOccurrence as addNextOccurrence } from "@codemirror/search"
import { EditorState } from "@codemirror/state"
import { Decoration, EditorView } from "@codemirror/view"

export { selectNextOccurrence, secondarySelectionMarks }

let secondarySelectionMark = Decoration.mark({
	class: "cm-secondarySelection",
})

// Touch devices hide drawSelection's layer in favor of the native highlight, which only covers the main range
let secondarySelectionMarks = EditorView.decorations.compute(
	["selection"],
	function markSecondarySelections(state: EditorState) {
		let { ranges, mainIndex } = state.selection
		return Decoration.set(
			ranges
				.filter((range, index) => index !== mainIndex && !range.empty)
				.map(range => secondarySelectionMark.range(range.from, range.to)),
		)
	},
)

function selectNextOccurrence(view: EditorView): boolean {
	if (addNextOccurrence(view)) return true

	let { main, ranges } = view.state.selection
	if (ranges.length < 2 || ranges.some(range => range.empty)) return false
	let selectedText = view.state.sliceDoc(main.from, main.to)
	if (
		ranges.some(
			range => view.state.sliceDoc(range.from, range.to) !== selectedText,
		)
	)
		return false

	view.dispatch({
		effects: EditorView.scrollIntoView(main, { y: "center" }),
	})
	return true
}
