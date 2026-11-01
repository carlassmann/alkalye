export { getSidebarKeyboardAction }
export type { SidebarKeyboardRow, SidebarKeyboardAction }

type SidebarKeyboardRow =
	| { type: "doc"; depth: number }
	| { type: "folder"; depth: number; isCollapsed: boolean }

type SidebarKeyboardAction =
	| { type: "focus"; index: number }
	| { type: "toggleFolder"; index: number }
	| { type: "leaveTop" }

function getSidebarKeyboardAction(
	key: string,
	index: number,
	rows: SidebarKeyboardRow[],
): SidebarKeyboardAction | null {
	let row = rows[index]
	if (!row) return null
	let lastIndex = rows.length - 1

	switch (key) {
		case "ArrowDown":
			return index < lastIndex ? { type: "focus", index: index + 1 } : null
		case "ArrowUp":
			return index > 0
				? { type: "focus", index: index - 1 }
				: { type: "leaveTop" }
		case "Home":
			return { type: "focus", index: 0 }
		case "End":
			return { type: "focus", index: lastIndex }
		case "ArrowRight": {
			if (row.type !== "folder") return null
			if (row.isCollapsed) return { type: "toggleFolder", index }
			let firstChild = rows[index + 1]
			return firstChild && firstChild.depth > row.depth
				? { type: "focus", index: index + 1 }
				: null
		}
		case "ArrowLeft": {
			if (row.type === "folder" && !row.isCollapsed) {
				return { type: "toggleFolder", index }
			}
			let parentIndex = findParentFolderIndex(index, rows)
			return parentIndex === null ? null : { type: "focus", index: parentIndex }
		}
		default:
			return null
	}
}

function findParentFolderIndex(
	index: number,
	rows: SidebarKeyboardRow[],
): number | null {
	let depth = rows[index]?.depth ?? 0
	for (let i = index - 1; i >= 0; i--) {
		let row = rows[i]
		if (row?.type === "folder" && row.depth < depth) return i
	}
	return null
}
