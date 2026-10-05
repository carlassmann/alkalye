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
	side?: "top" | "bottom" | "left" | "right"
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
	if (options.side === "left" || options.side === "right") {
		let left = options.side === "left"
		if (left && anchor.left - panel.width - 4 < 8) left = false
		else if (!left && anchor.right + panel.width + 4 > viewport.width - 8)
			left = true
		return {
			...fitPanel(
				{
					x: left ? anchor.left - panel.width - 4 : anchor.right + 4,
					y: anchor.top,
				},
				panel,
				viewport,
			),
			side: left ? "left" : "right",
		}
	}
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
