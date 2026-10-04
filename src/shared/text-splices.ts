export interface TextSplice {
	start: number
	remove: number
	insert: string[]
}
type Step = "keep" | "remove" | { insert: string }

export function textSplices(
	before: readonly string[],
	after: readonly string[],
) {
	let start = 0,
		end = 0
	while (
		start < before.length &&
		start < after.length &&
		before[start] === after[start]
	)
		start++
	while (
		end < before.length - start &&
		end < after.length - start &&
		before[before.length - end - 1] === after[after.length - end - 1]
	)
		end++
	let old = before.slice(start, before.length - end),
		next = after.slice(start, after.length - end)
	if (!old.length && !next.length) return []
	if (!old.length || !next.length)
		return [{ start, remove: old.length, insert: next }]
	let steps = shortestEdit(old, next)
	if (!steps) return [{ start, remove: old.length, insert: next }]
	let splices: TextSplice[] = [],
		pending: TextSplice | undefined
	for (let step of steps) {
		if (step === "keep") {
			if (pending) splices.push(pending)
			pending = undefined
			start++
		} else {
			pending ??= { start, remove: 0, insert: [] }
			if (step === "remove") {
				pending.remove++
				start++
			} else pending.insert.push(step.insert)
		}
	}
	if (pending) splices.push(pending)
	return splices
}

function shortestEdit(before: readonly string[], after: readonly string[]) {
	let frontier = new Map<number, number>([[1, 0]])
	let trace: Map<number, number>[] = [],
		comparisons = 0
	// A large replacement must not monopolize the browser's input thread.
	for (
		let distance = 0;
		distance <= Math.min(before.length + after.length, 256);
		distance++
	) {
		trace.push(new Map(frontier))
		for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
			let down =
				diagonal === -distance ||
				(diagonal !== distance &&
					(frontier.get(diagonal - 1) ?? -1) <
						(frontier.get(diagonal + 1) ?? -1))
			let x = down
				? (frontier.get(diagonal + 1) ?? 0)
				: (frontier.get(diagonal - 1) ?? 0) + 1
			let y = x - diagonal
			while (x < before.length && y < after.length && before[x] === after[y]) {
				x++
				y++
				if (++comparisons > 1_000_000) return undefined
			}
			frontier.set(diagonal, x)
			if (x >= before.length && y >= after.length)
				return backtrack(before, after, trace)
		}
	}
	return undefined
}
function backtrack(
	before: readonly string[],
	after: readonly string[],
	trace: Map<number, number>[],
) {
	let x = before.length,
		y = after.length,
		steps: Step[] = []
	for (let distance = trace.length - 1; distance >= 0; distance--) {
		let frontier = trace[distance]
		if (!frontier) throw new Error("Missing diff frontier")
		let diagonal = x - y
		let down =
			diagonal === -distance ||
			(diagonal !== distance &&
				(frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
		let previousDiagonal = down ? diagonal + 1 : diagonal - 1
		let previousX = frontier.get(previousDiagonal) ?? 0,
			previousY = previousX - previousDiagonal
		while (x > previousX && y > previousY) {
			steps.push("keep")
			x--
			y--
		}
		if (!distance) break
		if (x === previousX) {
			let value = after[--y]
			if (value === undefined) throw new Error("Missing inserted character")
			steps.push({ insert: value })
		} else {
			steps.push("remove")
			x--
		}
	}
	return steps.reverse()
}
