import { html } from "../language"

// A space's avatar, or its initials as in the original's space selector.
export function spaceAvatar(
	name: string,
	image = "",
	size: "sm" | "md" = "sm",
) {
	return image
		? html`<img
				class="space-avatar"
				data-size="${size}"
				src="${image}"
				alt="${name}"
			/>`
		: html`<span class="space-avatar" data-size="${size}" aria-hidden="true"
				>${spaceInitials(name)}</span
			>`
}

export function spaceInitials(name: string) {
	let words = name.trim().split(/\s+/).filter(Boolean)
	let first = words[0]
	if (!first) return "?"
	let last = words.length > 1 ? words[words.length - 1] : undefined
	return (
		[...first][0]?.toUpperCase() +
		(last ? ([...last][0]?.toUpperCase() ?? "") : "")
	)
}

// The original's avatar cropper: a square window over the image; dragging
// moves it, the wheel or a pinch zooms, and the result is a small JPEG.
export function cropAvatar(
	source: HTMLImageElement,
	crop: { x: number; y: number; size: number },
	output = 256,
) {
	let canvas = document.createElement("canvas")
	canvas.width = output
	canvas.height = output
	let context = canvas.getContext("2d")
	if (!context) throw new Error("This browser cannot crop images")
	context.fillStyle = "#fff"
	context.fillRect(0, 0, output, output)
	context.drawImage(
		source,
		crop.x,
		crop.y,
		crop.size,
		crop.size,
		0,
		0,
		output,
		output,
	)
	for (let quality of [0.86, 0.75, 0.6, 0.45]) {
		let image = canvas.toDataURL("image/jpeg", quality)
		if (image.length <= 120_000) return image
	}
	throw new Error("This image is too detailed for an avatar")
}

export interface AvatarView {
	width: number
	height: number
	image: { width: number; height: number }
	zoom: number
	x: number
	y: number
}

// The crop window is the largest square that fits with a margin; the image
// always covers it.
export function avatarLayout(view: AvatarView) {
	let size = Math.max(1, Math.min(view.width, view.height) - 32)
	let zoom = Math.max(1, Math.min(3, view.zoom))
	let scale = (size / Math.min(view.image.width, view.image.height)) * zoom
	let limitX = Math.max(0, (view.image.width * scale - size) / 2)
	let limitY = Math.max(0, (view.image.height * scale - size) / 2)
	let x = Math.max(-limitX, Math.min(limitX, view.x))
	let y = Math.max(-limitY, Math.min(limitY, view.y))
	return {
		size,
		zoom,
		scale,
		x,
		y,
		left: view.width / 2 + x - (view.image.width * scale) / 2,
		top: view.height / 2 + y - (view.image.height * scale) / 2,
		crop: {
			x: ((view.image.width * scale) / 2 - x - size / 2) / scale,
			y: ((view.image.height * scale) / 2 - y - size / 2) / scale,
			size: size / scale,
		},
	}
}
