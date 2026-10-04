export function replaceSelectedMatch(
	source: string,
	pattern: RegExp,
	replacement: string,
	start: number,
	end: number,
) {
	let matchAtSelection = new RegExp(
		pattern.source,
		pattern.flags.replace(/[gy]/g, "") + "y",
	)
	matchAtSelection.lastIndex = start
	let match = matchAtSelection.exec(source)
	if (!match || match[0].length !== end - start) return
	matchAtSelection.lastIndex = start
	let changed = source.replace(matchAtSelection, replacement)
	return changed.slice(start, changed.length - (source.length - end))
}
