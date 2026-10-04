export interface Size {
	width: number
	height: number
}
export interface Position {
	x: number
	y: number
}
export interface Anchor {
	left: number
	right: number
	top: number
	bottom: number
}
export interface PlacementOptions {
	side?: "top" | "bottom"
	align?: "start" | "end"
}

export function fitPanel(
	point: Position,
	panel: Size,
	viewport: Size,
): Position {
	return {
		x: Math.max(8, Math.min(point.x, viewport.width - panel.width - 8)),
		y: Math.max(8, Math.min(point.y, viewport.height - panel.height - 8)),
	}
}

export function placePanel(
	anchor: Anchor,
	panel: Size,
	viewport: Size,
	options: PlacementOptions = {},
) {
	let roomAbove = anchor.top - panel.height - 4 >= 8
	let above =
		options.side === "top"
			? roomAbove
			: anchor.bottom + panel.height + 4 > viewport.height && roomAbove
	let position = fitPanel(
		{
			x: options.align === "end" ? anchor.right - panel.width : anchor.left,
			y: above ? anchor.top - panel.height - 4 : anchor.bottom + 4,
		},
		panel,
		viewport,
	)
	return { ...position, side: above ? "top" : "bottom" }
}
