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

// Presenters who move at the same moment must still agree on one position.
// Each move carries a hybrid logical time: never earlier than any move its
// presenter has seen, so a later move always outranks the moves it answers,
// and truly simultaneous moves fall to the same presenter everywhere.
export interface PresentationLead {
	movedAt: number
	actor: string
}

export function leads(a: PresentationLead, b: PresentationLead) {
	return a.movedAt !== b.movedAt ? a.movedAt > b.movedAt : a.actor > b.actor
}

export function presentationLeader(
	people: readonly Presence[],
	document: string,
	now: number,
) {
	let leader: (Presence & PresentationLead) | undefined
	for (let person of people) {
		let movedAt = person.movedAt ?? 0
		if (
			!person.presenting ||
			person.board ||
			person.document !== document ||
			now - person.time > 10000 ||
			!Number.isSafeInteger(movedAt) ||
			movedAt > now + maximumPresentationSkew ||
			movedAt <= 0
		)
			continue
		let candidate = { ...person, movedAt }
		if (!leader || leads(candidate, leader)) leader = candidate
	}
	return leader
}

export let maximumPresentationSkew = 5000

export function nextMove(
	now: number,
	people: readonly Presence[],
	previous = 0,
) {
	let ceiling = Math.floor(now) + maximumPresentationSkew
	let seen =
		Number.isSafeInteger(previous) && previous <= ceiling ? previous : 0
	for (let person of people) {
		let move = person.movedAt ?? 0
		if (Number.isSafeInteger(move) && move <= ceiling)
			seen = Math.max(seen, move)
	}
	return Math.min(ceiling, Math.max(Math.floor(now), seen + 1))
}
