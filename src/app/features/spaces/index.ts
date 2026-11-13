export { MoveToSpaceDialog }
function MoveToSpaceDialog(_props: {
	doc?: unknown
	docs?: unknown
	me?: unknown
	open?: boolean
	onOpenChange?: (open: boolean) => void
	currentSpaceId?: string
	onMove?: (destination: { id: string; name: string } | null) => void
	onMoved?: () => void
}) {
	// v2-todo(spaces): trusted space reassignment.
	return null
}

export { SpaceSelector } from "./widgets/space-selector"
