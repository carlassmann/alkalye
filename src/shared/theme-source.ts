import * as Schema from "effect/Schema"
import { compileTheme, ThemeSourceError } from "./markdown"

let metadataBlock =
	/^(`{3,}|~{3,})json theme metadata[^\S\r\n]*\r?\n([\s\S]*?)^\1[^\S\r\n]*(?=\r?\n|$)/m
let metadataJson = Schema.fromJsonString(
	Schema.Record(Schema.String, Schema.Unknown),
)

export function themeName(source: string, fallback = "Custom theme") {
	try {
		return compileTheme(source).metadata.name.trim() || fallback
	} catch {
		return fallback
	}
}

export function withThemeName(source: string, name: string) {
	let block = metadataBlock.exec(source)
	if (!block)
		return (
			source.trimEnd() +
			"\n\n```json theme metadata\n" +
			JSON.stringify({ name }, null, 2) +
			"\n```\n"
		)
	let metadata = Schema.decodeUnknownSync(metadataJson)(block[2] ?? "{}")
	let fence = block[1] ?? "```"
	let updated =
		fence +
		"json theme metadata\n" +
		JSON.stringify({ ...metadata, name }, null, 2) +
		"\n" +
		fence
	return (
		source.slice(0, block.index) +
		updated +
		source.slice(block.index + block[0].length)
	)
}

// The original's starting point: overrides on top of Alkalye's default
// layout and typography, for both appearances.
export let defaultThemeSource = `# Custom theme

Edit these overrides. Alkalye supplies the default layout and typography.

\`\`\`css theme
:scope[data-appearance="light"] {
	--theme-paper: #ffffff;
	--theme-ink: #525252;
	--theme-accent: #2563eb;
}

:scope[data-appearance="dark"] {
	--theme-paper: #0a0a0a;
	--theme-ink: #d4d4d4;
	--theme-accent: #93c5fd;
}

:scope,
.document,
[data-mode="slideshow"] {
	background: var(--theme-paper);
	color: var(--theme-ink);
}

.document .content {
	color: var(--theme-ink);
}

.document .content a,
[data-mode="slideshow"] a {
	color: var(--theme-accent);
}
\`\`\`
`

export interface ThemeSourceProblem {
	line: number
	message: string
}

export function themeSourceProblems(source: string): ThemeSourceProblem[] {
	try {
		compileTheme(source)
		return []
	} catch (error) {
		if (error instanceof ThemeSourceError)
			return [{ line: Math.max(1, error.line), message: error.reason }]
		return [
			{
				line: 1,
				message: error instanceof Error ? error.message : String(error),
			},
		]
	}
}

// Source offsets of a 1-based line, without its line break.
export function lineRange(source: string, line: number) {
	let start = 0
	for (let current = 1; current < line; current++) {
		let next = source.indexOf("\n", start)
		if (next < 0) return { start: source.length, end: source.length }
		start = next + 1
	}
	let end = source.indexOf("\n", start)
	return { start, end: end < 0 ? source.length : end }
}
