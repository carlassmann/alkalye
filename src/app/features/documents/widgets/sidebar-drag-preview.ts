export { setSidebarDragPreview }

let maxPreviewTitles = 3

// The browser snapshots the drag image once, so it is built from plain DOM and removed right after
function setSidebarDragPreview(
	event: DragEvent,
	titles: string[],
	moreLabel: (count: number) => string,
) {
	let preview = document.createElement("div")
	preview.className =
		"bg-background text-foreground border-border fixed -top-[1000px] left-0 flex w-56 flex-col border text-sm shadow-md"
	if (titles.length > 1) {
		preview.style.boxShadow =
			"4px 4px 0 -1px var(--background), 4px 4px 0 0 var(--border)"
	}
	for (let title of titles.slice(0, maxPreviewTitles)) {
		let row = document.createElement("div")
		row.className =
			"border-border truncate border-b px-3 py-1.5 last:border-b-0"
		row.textContent = title
		preview.append(row)
	}
	let hiddenCount = titles.length - maxPreviewTitles
	if (hiddenCount > 0) {
		let more = document.createElement("div")
		more.className = "text-muted-foreground px-3 py-1.5 text-xs"
		more.textContent = moreLabel(hiddenCount)
		preview.append(more)
	}
	document.body.append(preview)
	event.dataTransfer?.setDragImage(preview, 16, 16)
	requestAnimationFrame(() => preview.remove())
}
