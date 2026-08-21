import { type EditorView } from "@codemirror/view"

export { deleteMarkerBackward, deleteMarkerForward }

let fixedMarkers = ["**", "__", "~~", "*", "_"]

function deleteMarkerBackward(view: EditorView): boolean {
	if (view.state.selection.ranges.length > 1) return false
	let range = view.state.selection.main
	if (!range.empty) return false
	let marker = emptyMarkerAtCursor(view, range.from)
	if (!marker) return false
	view.dispatch({
		changes: [
			{ from: range.from - marker.length, to: range.from },
			{ from: range.from, to: range.from + marker.length },
		],
		selection: { anchor: range.from - marker.length },
		scrollIntoView: true,
		userEvent: "delete.backward",
	})
	return true
}

function deleteMarkerForward(view: EditorView): boolean {
	if (view.state.selection.ranges.length > 1) return false
	let range = view.state.selection.main
	if (!range.empty) return false
	let emptyMarker = emptyMarkerAtCursor(view, range.from)
	if (emptyMarker) {
		view.dispatch({
			changes: [
				{ from: range.from - emptyMarker.length, to: range.from },
				{ from: range.from, to: range.from + emptyMarker.length },
			],
			selection: { anchor: range.from - emptyMarker.length },
			scrollIntoView: true,
			userEvent: "delete.forward",
		})
		return true
	}

	let line = view.state.doc.lineAt(range.from)
	let before = view.state.sliceDoc(line.from, range.from)
	let after = view.state.sliceDoc(range.from, line.to)
	let marker = closingMarkerAtCursor(before, after)
	if (!marker) return false
	view.dispatch({
		changes: { from: range.from, to: range.from + marker.length },
		selection: { anchor: range.from },
		scrollIntoView: true,
		userEvent: "delete.forward",
	})
	return true
}

function emptyMarkerAtCursor(
	view: EditorView,
	position: number,
): string | null {
	let line = view.state.doc.lineAt(position)
	let before = view.state.sliceDoc(line.from, position)
	let after = view.state.sliceDoc(position, line.to)
	let backticks = matchingBacktickRuns(before, after)
	if (backticks) return backticks
	return (
		fixedMarkers.find(
			marker => before.endsWith(marker) && after.startsWith(marker),
		) ?? null
	)
}

function matchingBacktickRuns(before: string, after: string): string | null {
	let left = before.match(/`+$/)?.[0] ?? ""
	let right = after.match(/^`+/)?.[0] ?? ""
	return left && left.length === right.length ? left : null
}

function closingMarkerAtCursor(before: string, after: string): string | null {
	let backticks = after.match(/^`+/)?.[0]
	if (backticks && countOccurrences(before, backticks) % 2 === 1)
		return backticks
	for (let marker of fixedMarkers) {
		if (after.startsWith(marker) && countOccurrences(before, marker) % 2 === 1)
			return marker
	}
	return null
}

function countOccurrences(value: string, marker: string): number {
	let count = 0
	let position = 0
	while (position <= value.length - marker.length) {
		let found = value.indexOf(marker, position)
		if (found < 0) break
		count++
		position = found + marker.length
	}
	return count
}
