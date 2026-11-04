export { diffVisitorEdit, applyVisitorEdit }
export type { VisitorEdit }

// What a visitor changed in the scripted document, with enough text around
// it to find the same spot again once the script has moved on.
interface VisitorEdit {
	before: string
	removed: string
	inserted: string
	after: string
}

let contextLength = 32

function diffVisitorEdit(scripted: string, edited: string): VisitorEdit | null {
	if (scripted === edited) return null
	let start = 0
	while (
		start < scripted.length &&
		start < edited.length &&
		scripted[start] === edited[start]
	)
		start++
	let end = 0
	while (
		end < scripted.length - start &&
		end < edited.length - start &&
		scripted[scripted.length - 1 - end] === edited[edited.length - 1 - end]
	)
		end++
	return {
		before: scripted.slice(Math.max(0, start - contextLength), start),
		removed: scripted.slice(start, scripted.length - end),
		inserted: edited.slice(start, edited.length - end),
		after: scripted.slice(
			scripted.length - end,
			scripted.length - end + contextLength,
		),
	}
}

// Replays the visitor's edit on a later version of the script. Positions of
// scripted cursors move along with the inserted text.
function applyVisitorEdit(
	content: string,
	edit: VisitorEdit,
): { content: string; mapPosition: (position: number) => number } {
	let from = findEditStart(content, edit)
	let removedHere = content.startsWith(edit.removed, from)
		? edit.removed.length
		: 0
	let next =
		content.slice(0, from) + edit.inserted + content.slice(from + removedHere)
	let shift = edit.inserted.length - removedHere
	return {
		content: next,
		mapPosition: position => (position > from ? position + shift : position),
	}
}

function findEditStart(content: string, edit: VisitorEdit): number {
	let exact = content.indexOf(edit.before + edit.removed + edit.after)
	if (exact !== -1) return exact + edit.before.length
	if (edit.before) {
		let afterBefore = content.indexOf(edit.before)
		if (afterBefore !== -1) return afterBefore + edit.before.length
	}
	if (edit.after) {
		let beforeAfter = content.indexOf(edit.after)
		if (beforeAfter !== -1) return beforeAfter
	}
	return content.length
}
