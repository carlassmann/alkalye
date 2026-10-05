// Drawings store the colours a person picked on a light page. A dark canvas
// shows each ink by its role instead: black and grey writing turns light,
// pale tints turn into deep tints, and saturated colours, even deep ones, stay
// recognisably themselves.
// Exports and previews keep the stored colours.

let darkInks: Record<string, string> = {
	"#1d1d1d": "#f2f2f2",
	"#9fa8b2": "#9398b0",
	"#4465e9": "#4f72fc",
	"#4ba1f1": "#4dabf7",
	"#ffffff": "#1d1d1d",
}

export let lightCanvas = "#f8f9fa"
export let darkCanvas = "#101011"

export function inkColor(color: string, dark: boolean) {
	if (!dark || !/^#[a-f\d]{6}$/i.test(color)) return color
	let known = darkInks[color.toLowerCase()]
	if (known) return known
	let [hue, saturation, lightness] = hsl(color)
	if (lightness < 0.35 && (saturation < 0.3 || lightness < 0.2))
		return hex(hue, saturation, Math.min(0.95, Math.max(0.62, 1 - lightness)))
	if (lightness > 0.8)
		return hex(
			hue,
			Math.min(saturation, 0.55),
			Math.max(0.08, (1 - lightness) * 1.4 + 0.08),
		)
	return color
}

// Black or white, whichever reads better on `color`.
export function contrastInk(color: string) {
	let [red, green, blue] = channels(color).map(channel => {
		let value = channel / 255
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
	})
	let luminance =
		0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0)
	return luminance > 0.4 ? "#1d1d1d" : "#ffffff"
}

function channels(color: string) {
	return [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
}

function hsl(color: string): [number, number, number] {
	let [red = 0, green = 0, blue = 0] = channels(color).map(value => value / 255)
	let high = Math.max(red, green, blue),
		low = Math.min(red, green, blue),
		lightness = (high + low) / 2
	if (high === low) return [0, 0, lightness]
	let range = high - low
	let saturation =
		lightness > 0.5 ? range / (2 - high - low) : range / (high + low)
	let hue =
		high === red
			? (green - blue) / range + (green < blue ? 6 : 0)
			: high === green
				? (blue - red) / range + 2
				: (red - green) / range + 4
	return [hue / 6, saturation, lightness]
}

function hex(hue: number, saturation: number, lightness: number) {
	let q =
		lightness < 0.5
			? lightness * (1 + saturation)
			: lightness + saturation - lightness * saturation
	let p = 2 * lightness - q
	return (
		"#" +
		[hue + 1 / 3, hue, hue - 1 / 3]
			.map(value => {
				let t = value < 0 ? value + 1 : value > 1 ? value - 1 : value
				let channel =
					t < 1 / 6
						? p + (q - p) * 6 * t
						: t < 1 / 2
							? q
							: t < 2 / 3
								? p + (q - p) * (2 / 3 - t) * 6
								: p
				return Math.round(channel * 255)
					.toString(16)
					.padStart(2, "0")
			})
			.join("")
	)
}
