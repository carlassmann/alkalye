let searchHighlight: Highlight | undefined

export function nativeSearchHighlights() {
	if (
		typeof Highlight !== "function" ||
		!CSS.highlights ||
		!CSS.supports("selector(::highlight(alkalye-search))")
	)
		return
	let name = "alkalye-search"
	let highlight = (searchHighlight ??= new Highlight())
	let ranges: Range[] = []
	return {
		replace(next: Range[]) {
			for (let range of ranges) highlight.delete(range)
			ranges = next
			for (let range of ranges) highlight.add(range)
			if (highlight.size) {
				if (CSS.highlights.get(name) !== highlight)
					CSS.highlights.set(name, highlight)
			} else if (CSS.highlights.get(name) === highlight)
				CSS.highlights.delete(name)
		},
	}
}
