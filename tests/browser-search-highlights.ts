export let searchHighlightCount =
	'(document.querySelectorAll(".search-match").length + (CSS.highlights?.get("alkalye-search")?.size ?? 0))'

export let searchHighlightsVisible = `(() => {
	let ranges = [...(CSS.highlights?.get("alkalye-search") ?? [])];
	let marks = [...document.querySelectorAll(".search-match")];
	return ranges.every(range => {
		let rectangles = [...range.getClientRects()];
		let element = range.startContainer.parentElement;
		return rectangles.some(rectangle => rectangle.width > 0 && rectangle.height > 0)
			&& element && getComputedStyle(element, "::highlight(alkalye-search)").backgroundColor !== "rgba(0, 0, 0, 0)";
	}) && marks.every(mark => {
		let rectangle = mark.getBoundingClientRect();
		return rectangle.width > 0 && rectangle.height > 0 && getComputedStyle(mark).backgroundColor !== "rgba(0, 0, 0, 0)";
	});
})()`
