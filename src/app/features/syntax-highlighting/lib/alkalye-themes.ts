import { type ThemeRegistrationRaw } from "shiki/core"

export { alkalyeDarkTheme, alkalyeLightTheme }

let sharedTokenColors: ThemeRegistrationRaw["tokenColors"] = [
	{
		scope: ["comment", "string.quoted.docstring.multi"],
		settings: { foreground: "#737373", fontStyle: "italic" },
	},
	{
		scope: [
			"keyword",
			"constant",
			"storage",
			"keyword.operator",
			"punctuation",
		],
		settings: { foreground: "#737373" },
	},
	{
		scope: ["entity.name.type", "entity.other.inherited-class", "support.type"],
		settings: { foreground: "#737373", fontStyle: "italic" },
	},
	{
		scope: ["entity.name.function", "support.function"],
		settings: { fontStyle: "bold" },
	},
]

let alkalyeLightTheme: ThemeRegistrationRaw = {
	name: "alkalye-light",
	type: "light",
	colors: {
		"editor.background": "#ffffff",
		"editor.foreground": "#0a0a0a",
	},
	settings: [{ settings: { foreground: "#0a0a0a" } }, ...sharedTokenColors],
}

let alkalyeDarkTheme: ThemeRegistrationRaw = {
	name: "alkalye-dark",
	type: "dark",
	colors: {
		"editor.background": "#0a0a0a",
		"editor.foreground": "#fafafa",
	},
	settings: [
		{ settings: { foreground: "#fafafa" } },
		...sharedTokenColors.map(tokenColor => ({
			...tokenColor,
			settings: {
				...tokenColor.settings,
				foreground:
					tokenColor.settings.foreground === "#737373"
						? "#a1a1aa"
						: tokenColor.settings.foreground,
			},
		})),
	],
}
