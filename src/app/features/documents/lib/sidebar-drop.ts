export { getSidebarDropAction }
export type { SidebarDropAction }

type SidebarDropAction =
	| { type: "moveToFolder"; count: number; folder: string }
	| { type: "moveToRoot"; count: number }
	| { type: "alreadyThere"; folder: string | null }

function getSidebarDropAction(
	docPaths: (string | null)[],
	targetPath: string | null,
): SidebarDropAction {
	let movingCount = docPaths.filter(path => path !== targetPath).length
	if (movingCount === 0) return { type: "alreadyThere", folder: targetPath }
	if (targetPath === null) return { type: "moveToRoot", count: movingCount }
	return { type: "moveToFolder", count: movingCount, folder: targetPath }
}
