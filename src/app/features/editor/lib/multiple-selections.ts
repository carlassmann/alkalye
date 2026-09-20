import { selectNextOccurrence as addNextOccurrence } from "@codemirror/search"
import { EditorView } from "@codemirror/view"

export { selectNextOccurrence }

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
