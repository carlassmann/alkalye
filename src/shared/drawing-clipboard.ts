import type { DrawingEntry, Shape } from "./drawing"
import { terminals } from "./drawing"

// Pasting within the app keeps every editable field; other applications read
// the plain text and the image that accompany it.
export let drawingClipboardType = "application/x-alkalye-drawing"

export function drawingDocument(entries: Iterable<[string, Shape]>) {
	return {
		format: "alkalye-drawing-v1",
		shapes: [...entries].map(([id, shape]) => ({ id, ...shape })),
	}
}

// Gives pasted or duplicated shapes fresh keys and groups. Bindings follow
// targets copied with them; bindings to anything left behind are released,
// as is a group with only one copied member.
export function rekeyShapes(
	entries: readonly DrawingEntry[],
	key: () => string,
	group: () => string,
): [string, Shape][] {
	let keys = new Map<string, string>(),
		claimed = new Set<string>()
	for (let entry of entries) if (!keys.has(entry.id)) keys.set(entry.id, key())
	let groups = new Map<string, string>(),
		members = new Map<string, number>()
	for (let entry of entries)
		if (entry.shape.group)
			members.set(entry.shape.group, (members.get(entry.shape.group) ?? 0) + 1)
	return entries.map(entry => {
		let shape: Shape = { ...entry.shape }
		for (let terminal of terminals) {
			let binding = shape[terminal]
			let target = binding && keys.get(binding.shape)
			if (binding && target) shape[terminal] = { ...binding, shape: target }
			else delete shape[terminal]
		}
		if (shape.group && (members.get(shape.group) ?? 0) < 2) delete shape.group
		if (shape.group) {
			let renamed = groups.get(shape.group) ?? group()
			groups.set(shape.group, renamed)
			shape.group = renamed
		}
		let next = keys.get(entry.id)
		if (!next || claimed.has(next)) next = key()
		claimed.add(next)
		return [next, shape]
	})
}

export function clipboardText(shapes: Iterable<Shape>) {
	return [...shapes]
		.map(shape => shape.text.trim())
		.filter(Boolean)
		.join("\n")
}
