export {
	emptySidebarSelection,
	toggleSidebarSelection,
	extendSidebarSelection,
	pruneSidebarSelection,
}
export type { SidebarSelection }

type SidebarSelection = {
	ids: string[]
	anchorId: string | null
}

let emptySidebarSelection: SidebarSelection = { ids: [], anchorId: null }

function toggleSidebarSelection(
	selection: SidebarSelection,
	id: string,
	activeId: string | undefined,
): SidebarSelection {
	let ids = seedWithActive(selection.ids, activeId, id)
	if (ids.includes(id)) {
		let remaining = ids.filter(selectedId => selectedId !== id)
		return { ids: remaining, anchorId: remaining.at(-1) ?? null }
	}
	return { ids: [...ids, id], anchorId: id }
}

function extendSidebarSelection(
	selection: SidebarSelection,
	id: string,
	activeId: string | undefined,
	orderedIds: string[],
): SidebarSelection {
	let anchorId = selection.anchorId ?? activeId ?? id
	let anchorIndex = orderedIds.indexOf(anchorId)
	let targetIndex = orderedIds.indexOf(id)
	if (anchorIndex === -1 || targetIndex === -1) {
		return { ids: [id], anchorId: id }
	}
	let start = Math.min(anchorIndex, targetIndex)
	let end = Math.max(anchorIndex, targetIndex)
	return { ids: orderedIds.slice(start, end + 1), anchorId }
}

function pruneSidebarSelection(
	selection: SidebarSelection,
	visibleIds: string[],
): SidebarSelection {
	let ids = selection.ids.filter(id => visibleIds.includes(id))
	if (ids.length === selection.ids.length) return selection
	let anchorId =
		selection.anchorId && ids.includes(selection.anchorId)
			? selection.anchorId
			: (ids.at(-1) ?? null)
	return { ids, anchorId }
}

// The open document looks selected, so the first modifier-click keeps it in the selection
function seedWithActive(
	ids: string[],
	activeId: string | undefined,
	clickedId: string,
): string[] {
	if (ids.length > 0 || !activeId || activeId === clickedId) return ids
	return [activeId]
}
