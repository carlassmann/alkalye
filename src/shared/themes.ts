import { array, object, string } from "./model"

export interface ThemePreset {
	name: string
	appearance: "light" | "dark"
	variables: Record<string, string>
}
export interface ThemeMetadata {
	name: string
	presets: ThemePreset[]
}
export function themeMetadata(value: unknown): ThemeMetadata {
	let metadata = object(value)
	return {
		name: typeof metadata.name === "string" ? metadata.name : "",
		presets:
			metadata.presets === undefined
				? []
				: array(metadata.presets).map(parsePreset),
	}
}
function parsePreset(value: unknown): ThemePreset {
	let preset = object(value),
		colors = object(preset.colors)
	if (preset.appearance !== "light" && preset.appearance !== "dark")
		throw new Error("A preset needs a light or dark appearance")
	let variables: Record<string, string> = {}
	for (let [field, name] of Object.entries({
		background: "background",
		foreground: "foreground",
		accent: "accent",
		heading: "heading",
		link: "link",
		codeBackground: "code-background",
	})) {
		if (colors[field] !== undefined)
			variables[`--preset-${name}`] = string(colors[field])
	}
	for (let required of ["background", "foreground", "accent"])
		if (!variables[`--preset-${required}`])
			throw new Error(`A preset needs a ${required} color`)
	variables["--preset-accent-1"] = variables["--preset-accent"] ?? ""
	if (colors.accents !== undefined)
		for (let [index, color] of array(colors.accents).entries())
			variables[`--preset-accent-${index + 2}`] = string(color)
	if (preset.fonts !== undefined) {
		let fonts = object(preset.fonts)
		for (let name of ["title", "body"])
			if (fonts[name] !== undefined)
				variables[`--preset-font-${name}`] = string(fonts[name])
	}
	variables["--preset-appearance"] = preset.appearance
	return { name: string(preset.name), appearance: preset.appearance, variables }
}
export function resolvePreset(
	presets: ThemePreset[],
	name = "",
	appearance = "dark",
) {
	return (
		presets.find(preset => preset.name.toLowerCase() === name.toLowerCase()) ??
		presets.find(preset => preset.appearance === appearance) ??
		presets[0]
	)
}
