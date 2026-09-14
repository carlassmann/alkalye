import { diff } from "fast-myers-diff"

export { mergeFileContent }

interface Edit {
	from: number
	to: number
	insert: string
}

function mergeFileContent(base: string, local: string, disk: string) {
	if (base === disk) return { content: local, conflict: false }
	if (base === local) return { content: disk, conflict: false }
	if (local === disk) return { content: local, conflict: false }

	let localEdits = editsBetween(base, local)
	let diskEdits = editsBetween(base, disk)
	let conflict = localEdits.some(localEdit =>
		diskEdits.some(diskEdit => overlaps(localEdit, diskEdit)),
	)
	if (conflict) return { content: local, conflict: true }
	let edits = [...localEdits, ...diskEdits].sort(
		(a, b) => b.from - a.from || b.to - a.to,
	)
	let content = base
	for (let edit of edits)
		content = content.slice(0, edit.from) + edit.insert + content.slice(edit.to)
	return { content, conflict: false }
}

function editsBetween(before: string, after: string): Edit[] {
	let beforePoints = Array.from(before)
	let afterPoints = Array.from(after)
	let beforeOffsets = offsets(beforePoints)
	let afterOffsets = offsets(afterPoints)
	return Array.from(
		diff(beforePoints, afterPoints),
		([from, to, start, end]) => ({
			from: beforeOffsets[from],
			to: beforeOffsets[to],
			insert: after.slice(afterOffsets[start], afterOffsets[end]),
		}),
	)
}

function offsets(points: string[]) {
	let result = [0]
	for (let point of points)
		result.push(result[result.length - 1] + point.length)
	return result
}

function overlaps(a: Edit, b: Edit) {
	if (a.from === a.to && b.from === b.to) return a.from === b.from
	if (a.from === a.to) return a.from > b.from && a.from < b.to
	if (b.from === b.to) return b.from > a.from && b.from < a.to
	return a.from < b.to && b.from < a.to
}
