import type { Presence } from "./model"

// Every slideshow and teleprompter of a document shows one shared position,
// as the original's synchronized presentation line did. Presence carries each
// presenter's position; a presenter whose position changes has moved, and the
// latest move wins. A presenter seen for the first time has only joined.

export interface PresenterMoves {
	moved: Presence | undefined
	joined: Presence | undefined
}

export function presenterMoves(
	seen: Map<string, string>,
	people: readonly Presence[],
	document: string,
	now: number,
): PresenterMoves {
	let moved: Presence | undefined, joined: Presence | undefined
	for (let person of people) {
		if (
			!person.presenting ||
			person.board ||
			person.document !== document ||
			now - person.time > 10000
		)
			continue
		let position = person.slide + ":" + (person.item ?? "")
		let previous = seen.get(person.actor)
		seen.set(person.actor, position)
		if (previous === undefined) {
			if (!joined || person.time > joined.time) joined = person
		} else if (previous !== position && (!moved || person.time > moved.time))
			moved = person
	}
	return { moved, joined }
}
