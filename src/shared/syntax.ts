interface SyntaxFamily {
	id: string
	name: string
	dark: [string, string, string, string]
	light: [string, string, string, string]
}
let palettes: SyntaxFamily[] = [
	{
		id: "alkalye",
		name: "Alkalye",
		dark: ["#bd8ed9", "#35b38b", "#81938a", "#dda671"],
		light: ["#78469b", "#15775b", "#6b7971", "#9b6419"],
	},
	{
		id: "catppuccin",
		name: "Catppuccin",
		dark: ["#cba6f7", "#a6e3a1", "#9399b2", "#fab387"],
		light: ["#8839ef", "#40a02b", "#9ca0b0", "#fe640b"],
	},
	{
		id: "everforest",
		name: "Everforest",
		dark: ["#d699b6", "#a7c080", "#859289", "#e69875"],
		light: ["#df69ba", "#8da101", "#939f91", "#f57d26"],
	},
	{
		id: "github",
		name: "GitHub",
		dark: ["#ff7b72", "#a5d6ff", "#8b949e", "#79c0ff"],
		light: ["#cf222e", "#0a3069", "#6e7781", "#0550ae"],
	},
	{
		id: "gruvbox",
		name: "Gruvbox",
		dark: ["#fb4934", "#b8bb26", "#928374", "#d3869b"],
		light: ["#9d0006", "#79740e", "#928374", "#8f3f71"],
	},
	{
		id: "kanagawa",
		name: "Kanagawa",
		dark: ["#957fb8", "#98bb6c", "#727169", "#d27e99"],
		light: ["#624c83", "#6f894e", "#8a8980", "#b35b79"],
	},
	{
		id: "material",
		name: "Material",
		dark: ["#c792ea", "#c3e88d", "#697098", "#f78c6c"],
		light: ["#7c4dff", "#61822f", "#90a4ae", "#b85c32"],
	},
	{
		id: "min",
		name: "Min",
		dark: ["#f97583", "#b392f0", "#929292", "#79b8ff"],
		light: ["#d73a49", "#6f42c1", "#6a737d", "#005cc5"],
	},
	{
		id: "one",
		name: "One",
		dark: ["#c678dd", "#98c379", "#7f848e", "#d19a66"],
		light: ["#a626a4", "#50a14f", "#a0a1a7", "#986801"],
	},
	{
		id: "rose-pine",
		name: "Rosé Pine",
		dark: ["#c4a7e7", "#f6c177", "#908caa", "#ebbcba"],
		light: ["#907aa9", "#ea9d34", "#9893a5", "#d7827e"],
	},
	{
		id: "slack",
		name: "Slack",
		dark: ["#d5a3ff", "#a6cd8d", "#8a8f9e", "#ffd295"],
		light: ["#8a4baf", "#578d42", "#868686", "#b47716"],
	},
	{
		id: "solarized",
		name: "Solarized",
		dark: ["#859900", "#2aa198", "#839496", "#d33682"],
		light: ["#859900", "#2aa198", "#93a1a1", "#d33682"],
	},
	{
		id: "vitesse",
		name: "Vitesse",
		dark: ["#4d9375", "#c98a7d", "#758575", "#4c9a91"],
		light: ["#1e754f", "#ab5959", "#8c968a", "#2f798a"],
	},
	{
		id: "vs-code",
		name: "VS Code",
		dark: ["#c586c0", "#ce9178", "#6a9955", "#b5cea8"],
		light: ["#af00db", "#a31515", "#008000", "#098658"],
	},
]
export let syntaxFamilies = [
	"alkalye",
	"catppuccin",
	"catppuccin-frappe",
	"catppuccin-macchiato",
	"everforest",
	"github",
	"github-default",
	"github-dimmed",
	"github-high-contrast",
	"gruvbox",
	"gruvbox-hard",
	"gruvbox-soft",
	"kanagawa",
	"kanagawa-dragon",
	"material",
	"material-darker",
	"material-ocean",
	"material-palenight",
	"min",
	"one",
	"rose-pine",
	"rose-pine-moon",
	"slack",
	"solarized",
	"vitesse",
	"vitesse-black",
	"vs-code",
].map(id => ({
	id,
	name: id
		.split("-")
		.map(word => word[0]?.toUpperCase() + word.slice(1))
		.join(" "),
}))

export function syntaxColors(id = "alkalye", appearance = "dark") {
	let family =
		palettes.find(
			family => id === family.id || id.startsWith(family.id + "-"),
		) ?? palettes[0]
	let colors = (appearance === "light" ? family?.light : family?.dark) ?? [
		"",
		"",
		"",
		"",
	]
	let variants: Record<string, number> = {
		"catppuccin-frappe": 10,
		"catppuccin-macchiato": 5,
		"github-dimmed": -12,
		"github-high-contrast": 18,
		"gruvbox-hard": 12,
		"gruvbox-soft": -10,
		"kanagawa-dragon": -8,
		"material-darker": 10,
		"material-ocean": -8,
		"material-palenight": 5,
		"rose-pine-moon": 10,
		"vitesse-black": 14,
	}
	let tone = variants[id] ?? 0
	return tone
		? colors.map(
				color =>
					`color-mix(in srgb, ${color} ${100 - Math.abs(tone)}%, ${tone > 0 ? "white" : "black"})`,
			)
		: colors
}
