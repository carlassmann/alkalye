import type { Bounds, Point } from "../shared/drawing"

// A camera places the canvas: `x` and `y` are the drawing coordinates at the
// viewport's top-left corner and `zoom` is screen pixels per drawing unit.
export interface Camera {
	x: number
	y: number
	zoom: number
}
export interface Viewport {
	width: number
	height: number
}

let zoomStops = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8]
let minimumZoom = zoomStops[0] ?? 0.1
let maximumZoom = zoomStops[zoomStops.length - 1] ?? 8

export function clampZoom(zoom: number) {
	return Math.min(maximumZoom, Math.max(minimumZoom, zoom))
}

export function screenToWorld(camera: Camera, point: Point): Point {
	return {
		x: camera.x + point.x / camera.zoom,
		y: camera.y + point.y / camera.zoom,
	}
}

export function worldToScreen(camera: Camera, point: Point): Point {
	return {
		x: (point.x - camera.x) * camera.zoom,
		y: (point.y - camera.y) * camera.zoom,
	}
}

// Keeps the drawing point under `screen` fixed while the zoom changes, which
// is what makes wheel, pinch and button zooming feel anchored.
export function zoomAt(camera: Camera, screen: Point, zoom: number): Camera {
	let next = clampZoom(zoom),
		anchor = screenToWorld(camera, screen)
	return {
		x: anchor.x - screen.x / next,
		y: anchor.y - screen.y / next,
		zoom: next,
	}
}

export function panBy(camera: Camera, screenDelta: Point): Camera {
	return {
		...camera,
		x: camera.x - screenDelta.x / camera.zoom,
		y: camera.y - screenDelta.y / camera.zoom,
	}
}

export function nextZoomStop(zoom: number, direction: 1 | -1) {
	let stops = direction > 0 ? zoomStops : [...zoomStops].reverse()
	return (
		stops.find(stop =>
			direction > 0 ? stop > zoom + 1e-3 : stop < zoom - 1e-3,
		) ?? clampZoom(zoom)
	)
}

export function fitBounds(
	bounds: Bounds | undefined,
	viewport: Viewport,
	padding = 64,
): Camera {
	if (!bounds) return { x: 0, y: 0, zoom: 1 }
	let zoom = clampZoom(
		Math.min(
			1,
			(viewport.width - padding * 2) / Math.max(1, bounds.width),
			(viewport.height - padding * 2) / Math.max(1, bounds.height),
		),
	)
	return {
		x: bounds.x + bounds.width / 2 - viewport.width / 2 / zoom,
		y: bounds.y + bounds.height / 2 - viewport.height / 2 / zoom,
		zoom,
	}
}

export function cameraViewBox(camera: Camera, viewport: Viewport) {
	return `${camera.x} ${camera.y} ${Math.max(1, viewport.width) / camera.zoom} ${Math.max(1, viewport.height) / camera.zoom}`
}
