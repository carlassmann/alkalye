import { useAccount } from "jazz-tools/react"
import type { ThemeInput } from "shiki/core"
import {
	parseFrontmatter,
	setSyntaxTheme,
} from "@/app/features/editor/lib/frontmatter"
import { UserAccount } from "@/schema"
import { alkalyeDarkTheme, alkalyeLightTheme } from "./alkalye-themes"

export {
	SYNTAX_THEME_FAMILIES,
	getSyntaxThemeFamilyId,
	setSyntaxTheme,
	resolveSyntaxTheme,
	useSyntaxTheme,
	loadSyntaxHighlighter,
}

export type {
	SyntaxThemeFamilyId,
	SyntaxThemeFamily,
	SyntaxTheme,
	SyntaxHighlighter,
	SyntaxDecoration,
}

type SyntaxThemeFamilyId =
	| "alkalye"
	| "catppuccin"
	| "catppuccin-frappe"
	| "catppuccin-macchiato"
	| "everforest"
	| "github"
	| "github-default"
	| "github-dimmed"
	| "github-high-contrast"
	| "gruvbox"
	| "gruvbox-hard"
	| "gruvbox-soft"
	| "kanagawa"
	| "kanagawa-dragon"
	| "material"
	| "material-darker"
	| "material-ocean"
	| "material-palenight"
	| "min"
	| "one"
	| "rose-pine"
	| "rose-pine-moon"
	| "slack"
	| "solarized"
	| "vitesse"
	| "vitesse-black"
	| "vs-code"
type SyntaxTheme = keyof typeof syntaxThemeInputs

type SyntaxThemeFamily = {
	id: SyntaxThemeFamilyId
	name: string
	light: SyntaxTheme
	dark: SyntaxTheme
}

type SyntaxDecoration = {
	start: number
	end: number
	properties: { class: string }
}

type SyntaxHighlighter = {
	highlight: (params: {
		code: string
		language?: string
		theme: SyntaxTheme
		decorations?: SyntaxDecoration[]
	}) => string
}

let SYNTAX_THEME_FAMILIES: SyntaxThemeFamily[] = [
	{
		id: "alkalye",
		name: "Alkalye",
		light: "alkalye-light",
		dark: "alkalye-dark",
	},
	{
		id: "catppuccin",
		name: "Catppuccin",
		light: "catppuccin-latte",
		dark: "catppuccin-mocha",
	},
	{
		id: "catppuccin-frappe",
		name: "Catppuccin Frappé",
		light: "catppuccin-latte",
		dark: "catppuccin-frappe",
	},
	{
		id: "catppuccin-macchiato",
		name: "Catppuccin Macchiato",
		light: "catppuccin-latte",
		dark: "catppuccin-macchiato",
	},
	{
		id: "everforest",
		name: "Everforest",
		light: "everforest-light",
		dark: "everforest-dark",
	},
	{
		id: "github",
		name: "GitHub",
		light: "github-light",
		dark: "github-dark",
	},
	{
		id: "github-default",
		name: "GitHub Default",
		light: "github-light-default",
		dark: "github-dark-default",
	},
	{
		id: "github-dimmed",
		name: "GitHub Dimmed",
		light: "github-light-default",
		dark: "github-dark-dimmed",
	},
	{
		id: "github-high-contrast",
		name: "GitHub High Contrast",
		light: "github-light-high-contrast",
		dark: "github-dark-high-contrast",
	},
	{
		id: "gruvbox",
		name: "Gruvbox",
		light: "gruvbox-light-medium",
		dark: "gruvbox-dark-medium",
	},
	{
		id: "gruvbox-hard",
		name: "Gruvbox Hard",
		light: "gruvbox-light-hard",
		dark: "gruvbox-dark-hard",
	},
	{
		id: "gruvbox-soft",
		name: "Gruvbox Soft",
		light: "gruvbox-light-soft",
		dark: "gruvbox-dark-soft",
	},
	{
		id: "kanagawa",
		name: "Kanagawa",
		light: "kanagawa-lotus",
		dark: "kanagawa-wave",
	},
	{
		id: "kanagawa-dragon",
		name: "Kanagawa Dragon",
		light: "kanagawa-lotus",
		dark: "kanagawa-dragon",
	},
	{
		id: "material",
		name: "Material",
		light: "material-theme-lighter",
		dark: "material-theme",
	},
	{
		id: "material-darker",
		name: "Material Darker",
		light: "material-theme-lighter",
		dark: "material-theme-darker",
	},
	{
		id: "material-ocean",
		name: "Material Ocean",
		light: "material-theme-lighter",
		dark: "material-theme-ocean",
	},
	{
		id: "material-palenight",
		name: "Material Palenight",
		light: "material-theme-lighter",
		dark: "material-theme-palenight",
	},
	{
		id: "min",
		name: "Min",
		light: "min-light",
		dark: "min-dark",
	},
	{
		id: "one",
		name: "One",
		light: "one-light",
		dark: "one-dark-pro",
	},
	{
		id: "rose-pine",
		name: "Rosé Pine",
		light: "rose-pine-dawn",
		dark: "rose-pine",
	},
	{
		id: "rose-pine-moon",
		name: "Rosé Pine Moon",
		light: "rose-pine-dawn",
		dark: "rose-pine-moon",
	},
	{
		id: "slack",
		name: "Slack",
		light: "slack-ochin",
		dark: "slack-dark",
	},
	{
		id: "solarized",
		name: "Solarized",
		light: "solarized-light",
		dark: "solarized-dark",
	},
	{
		id: "vitesse",
		name: "Vitesse",
		light: "vitesse-light",
		dark: "vitesse-dark",
	},
	{
		id: "vitesse-black",
		name: "Vitesse Black",
		light: "vitesse-light",
		dark: "vitesse-black",
	},
	{
		id: "vs-code",
		name: "VS Code",
		light: "light-plus",
		dark: "dark-plus",
	},
]

function getSyntaxThemeFamilyId(content: string): string | null {
	let { frontmatter } = parseFrontmatter(content)
	let value = frontmatter?.["syntax-theme"]
	return typeof value === "string" && value.trim() ? value.trim() : null
}

function resolveSyntaxTheme(params: {
	content: string
	defaultFamilyId?: string | null
	appearance: "light" | "dark"
}): SyntaxTheme {
	let documentFamilyId = getSyntaxThemeFamilyId(params.content)
	let familyId = isSyntaxThemeFamilyId(documentFamilyId)
		? documentFamilyId
		: isSyntaxThemeFamilyId(params.defaultFamilyId)
			? params.defaultFamilyId
			: "github"
	let family = SYNTAX_THEME_FAMILIES.find(
		candidate => candidate.id === familyId,
	)
	return (
		family?.[params.appearance] ??
		(params.appearance === "dark" ? "github-dark" : "github-light")
	)
}

function useSyntaxTheme(
	content: string,
	appearance: "light" | "dark",
): SyntaxTheme {
	let me = useAccount(UserAccount, {
		resolve: { root: { settings: true } },
	})
	let defaultFamilyId = me.$isLoaded
		? me.root?.settings?.syntaxTheme
		: undefined
	return resolveSyntaxTheme({ content, defaultFamilyId, appearance })
}

let syntaxThemeInputs = {
	"alkalye-light": alkalyeLightTheme,
	"alkalye-dark": alkalyeDarkTheme,
	"catppuccin-latte": () => import("shiki/dist/themes/catppuccin-latte.mjs"),
	"catppuccin-frappe": () => import("shiki/dist/themes/catppuccin-frappe.mjs"),
	"catppuccin-macchiato": () =>
		import("shiki/dist/themes/catppuccin-macchiato.mjs"),
	"catppuccin-mocha": () => import("shiki/dist/themes/catppuccin-mocha.mjs"),
	"everforest-light": () => import("shiki/dist/themes/everforest-light.mjs"),
	"everforest-dark": () => import("shiki/dist/themes/everforest-dark.mjs"),
	"github-light": () => import("shiki/dist/themes/github-light.mjs"),
	"github-dark": () => import("shiki/dist/themes/github-dark.mjs"),
	"github-light-default": () =>
		import("shiki/dist/themes/github-light-default.mjs"),
	"github-dark-default": () =>
		import("shiki/dist/themes/github-dark-default.mjs"),
	"github-dark-dimmed": () =>
		import("shiki/dist/themes/github-dark-dimmed.mjs"),
	"github-light-high-contrast": () =>
		import("shiki/dist/themes/github-light-high-contrast.mjs"),
	"github-dark-high-contrast": () =>
		import("shiki/dist/themes/github-dark-high-contrast.mjs"),
	"gruvbox-light-hard": () =>
		import("shiki/dist/themes/gruvbox-light-hard.mjs"),
	"gruvbox-dark-hard": () => import("shiki/dist/themes/gruvbox-dark-hard.mjs"),
	"gruvbox-light-medium": () =>
		import("shiki/dist/themes/gruvbox-light-medium.mjs"),
	"gruvbox-dark-medium": () =>
		import("shiki/dist/themes/gruvbox-dark-medium.mjs"),
	"gruvbox-light-soft": () =>
		import("shiki/dist/themes/gruvbox-light-soft.mjs"),
	"gruvbox-dark-soft": () => import("shiki/dist/themes/gruvbox-dark-soft.mjs"),
	"kanagawa-lotus": () => import("shiki/dist/themes/kanagawa-lotus.mjs"),
	"kanagawa-wave": () => import("shiki/dist/themes/kanagawa-wave.mjs"),
	"kanagawa-dragon": () => import("shiki/dist/themes/kanagawa-dragon.mjs"),
	"material-theme-lighter": () =>
		import("shiki/dist/themes/material-theme-lighter.mjs"),
	"material-theme": () => import("shiki/dist/themes/material-theme.mjs"),
	"material-theme-darker": () =>
		import("shiki/dist/themes/material-theme-darker.mjs"),
	"material-theme-ocean": () =>
		import("shiki/dist/themes/material-theme-ocean.mjs"),
	"material-theme-palenight": () =>
		import("shiki/dist/themes/material-theme-palenight.mjs"),
	"min-light": () => import("shiki/dist/themes/min-light.mjs"),
	"min-dark": () => import("shiki/dist/themes/min-dark.mjs"),
	"one-light": () => import("shiki/dist/themes/one-light.mjs"),
	"one-dark-pro": () => import("shiki/dist/themes/one-dark-pro.mjs"),
	"rose-pine-dawn": () => import("shiki/dist/themes/rose-pine-dawn.mjs"),
	"rose-pine": () => import("shiki/dist/themes/rose-pine.mjs"),
	"rose-pine-moon": () => import("shiki/dist/themes/rose-pine-moon.mjs"),
	"slack-ochin": () => import("shiki/dist/themes/slack-ochin.mjs"),
	"slack-dark": () => import("shiki/dist/themes/slack-dark.mjs"),
	"solarized-light": () => import("shiki/dist/themes/solarized-light.mjs"),
	"solarized-dark": () => import("shiki/dist/themes/solarized-dark.mjs"),
	"vitesse-light": () => import("shiki/dist/themes/vitesse-light.mjs"),
	"vitesse-dark": () => import("shiki/dist/themes/vitesse-dark.mjs"),
	"vitesse-black": () => import("shiki/dist/themes/vitesse-black.mjs"),
	"light-plus": () => import("shiki/dist/themes/light-plus.mjs"),
	"dark-plus": () => import("shiki/dist/themes/dark-plus.mjs"),
} satisfies Record<string, ThemeInput>

async function loadSyntaxHighlighter(
	theme: SyntaxTheme,
): Promise<SyntaxHighlighter> {
	let { loadHighlighter } = await import("./syntax-highlighter")
	return loadHighlighter(theme, syntaxThemeInputs[theme])
}

function isSyntaxThemeFamilyId(
	value: string | null | undefined,
): value is SyntaxThemeFamilyId {
	if (!value) return false
	return SYNTAX_THEME_FAMILIES.some(family => family.id === value)
}
