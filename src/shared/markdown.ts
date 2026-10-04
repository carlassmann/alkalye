import type { ThemeMetadata } from "./themes"
import { themeMetadata } from "./themes"
import * as Yaml from "effect/encoding/Yaml"
import * as Schema from "effect/Schema"
let decodeFrontmatter = Schema.decodeUnknownSync(
	Schema.Record(Schema.String, Schema.Unknown),
)
export interface Frontmatter {
	body: string
	values: Record<string, string>
	data: Record<string, unknown>
}
export interface Slide {
	content: string
	notes: string
}
export function frontmatter(source: string): Frontmatter {
	let match = frontmatterBlock(source)
	let values: Record<string, string> = {}
	let data: Record<string, unknown> = {}
	if (!match) return { body: source, values, data }
	try {
		let parsed = Yaml.parse(match[2] ?? "")
		data = decodeFrontmatter(parsed ?? {})
		for (let [key, value] of Object.entries(data)) {
			if (typeof value === "string") values[key] = value
			else if (typeof value === "boolean" || typeof value === "number")
				values[key] = String(value)
			else if (Array.isArray(value)) values[key] = JSON.stringify(value)
		}
	} catch {
		// Incomplete YAML is expected while typing; the Markdown body remains available.
	}
	return { body: source.slice(match[0].length), values, data }
}
export function frontmatterBlock(source: string) {
	let match = source.match(
		/^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m,
	)
	return match?.index === 0 ? match : undefined
}
export type FrontmatterValue =
	string | boolean | number | readonly string[] | undefined
export function withFrontmatter(
	source: string,
	values: Record<string, FrontmatterValue>,
) {
	let header = frontmatterBlock(source)
	if (
		header &&
		(header[2] ?? "")
			.replace(/^\s*#.*$/gm, "")
			.trimStart()
			.startsWith("{")
	) {
		let data = frontmatter(source).data
		if (Object.keys(data).length) {
			let newline = header[1]?.endsWith("\r\n") ? "\r\n" : "\n"
			let comments = (header[2] ?? "")
				.split(/\r?\n/)
				.flatMap(line =>
					/^\s*#/.test(line)
						? [line]
						: inlineComment(line)
							? [inlineComment(line).trimStart()]
							: [],
				)
			let fields = Object.entries(data).map(
				([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`,
			)
			source =
				(header[1] ?? "") +
				[...comments, ...fields].join(newline) +
				newline +
				(header[3] ?? "") +
				source.slice(header[0].length)
			header = frontmatterBlock(source)
		}
	}
	let newline =
		header?.[1]?.endsWith("\r\n") || (!header && source.includes("\r\n"))
			? "\r\n"
			: "\n"
	let lines = header ? (header[2] ?? "").split(/\r?\n/) : [],
		written = new Set<string>()
	if (lines.at(-1) === "") lines.pop()
	let result: string[] = []
	let replacing = false
	for (let line of lines) {
		let name = frontmatterKey(line)
		if (name) replacing = Object.hasOwn(values, name)
		if (name && replacing) {
			let anchor = line.match(/:\s*(&[^\s\[\]{},]+)\s+/)?.[1]
			if (!written.has(name) && (values[name] !== undefined || anchor))
				result.push(
					`${name}: ${anchor ? anchor + " " : ""}${JSON.stringify(values[name] ?? null)}${inlineComment(line)}`,
				)
			written.add(name)
		} else if (!replacing || !/^[ \t]+\S|^-\s/.test(line)) result.push(line)
	}
	for (let [name, value] of Object.entries(values))
		if (!written.has(name) && value !== undefined)
			result.push(`${name}: ${JSON.stringify(value)}`)
	if (!header && !result.length) return source
	let bom = !header && source.startsWith("\uFEFF") ? "\uFEFF" : ""
	let body = header ? source.slice(header[0].length) : source.slice(bom.length)
	if (header && !result.length && lines.length)
		return (source.startsWith("\uFEFF") ? "\uFEFF" : "") + body
	return (
		(header?.[1] ?? bom + "---" + newline) +
		(result.length ? result.join(newline) + newline : "") +
		(header?.[3] ?? "---" + newline) +
		body
	)
}
export function frontmatterKey(line: string) {
	let token = line.match(
		/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#].*?)[ \t]*:(?=\s|$)/,
	)?.[1]
	if (!token) return undefined
	try {
		return Object.keys(decodeFrontmatter(Yaml.parse(token + ": null")))[0]
	} catch {
		return undefined
	}
}

function inlineComment(line: string) {
	let quote = ""
	for (let index = 0; index < line.length; index++) {
		let character = line[index]
		if (quote === '"' && character === "\\") index++
		else if (quote === "'" && character === "'" && line[index + 1] === "'")
			index++
		else if (character === quote) quote = ""
		else if (!quote && (character === '"' || character === "'"))
			quote = character
		else if (!quote && character === "#" && /\s/.test(line[index - 1] ?? ""))
			return " " + line.slice(index)
	}
	return ""
}

export function escape(text: string) {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}
export function safeUrl(url: string): string {
	let trimmed = url.trim().replace(/[\u0000-\u0020]/g, "")
	return /^(https?:|mailto:|tel:|asset:|blob:|data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,)/i.test(
		trimmed,
	) ||
		/^(\/|#|\.\/)/.test(trimmed) ||
		!/^[^/?#]*:/.test(trimmed)
		? url
		: "#"
}
export function inline(
	source: string,
	references = new Map<string, string>(),
): string {
	let held: string[] = []
	function hold(html: string) {
		held.push(html)
		return `\u0000${held.length - 1}\u0000`
	}
	let text = source.replace(
		/\\([\\`*{}\[\]()#+.!_>~-])/g,
		(_, character: string) => hold(escape(character)),
	)
	text = text.replace(
		/(`+)([\s\S]*?)\1/g,
		(_, _delimiter: string, code: string) =>
			hold(`<code>${escape(code.replaceAll("\n", " "))}</code>`),
	)
	text = text.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, (_, url: string) =>
		hold(
			`<a href="${escape(safeUrl(url))}" rel="noopener noreferrer">${escape(url.replace(/^mailto:/, ""))}</a>`,
		),
	)
	text = text.replace(
		/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g,
		(_, alt: string, url: string) =>
			hold(
				`<img loading="lazy" alt="${escape(alt)}" src="${escape(safeUrl(url))}">`,
			),
	)
	text = text.replace(
		/\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g,
		(_, label: string, url: string, title: string) =>
			hold(
				`<a href="${escape(safeUrl(url))}"${title ? ` title="${escape(title)}"` : ""} rel="noopener noreferrer">${inline(label, references)}</a>`,
			),
	)
	text = text.replace(
		/\[([^\]]+)\]\[([^\]]*)\]/g,
		(match, label: string, key: string) => {
			let url = references.get((key || label).toLowerCase())
			return url
				? hold(
						`<a href="${escape(safeUrl(url))}">${inline(label, references)}</a>`,
					)
				: match
		},
	)
	text = text.replace(/\[\[([^\]]+)\]\]/g, (_, token: string) => {
		let [id = "", ...label] = token.split("|")
		return hold(
			`<a data-wikilink="${escape(id)}"${label.length ? ` data-wikilabel="${escape(label.join("|"))}"` : ""} href="#doc=${encodeURIComponent(id)}">${escape(label.length ? label.join("|") : id)}</a>`,
		)
	})
	text = text.replace(/https?:\/\/[^\s<>\u0000]+/g, url => {
		let clean = url.replace(/[.,;:!?]+$/g, "")
		return (
			hold(
				`<a href="${escape(safeUrl(clean))}" rel="noopener noreferrer">${escape(clean)}</a>`,
			) + url.slice(clean.length)
		)
	})
	text = escape(text)
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/__(.+?)__/g, "<strong>$1</strong>")
		.replace(/~~(.+?)~~/g, "<del>$1</del>")
		.replace(/\*([^*]+)\*/g, "<em>$1</em>")
		.replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1<em>$2</em>")
	return text.replace(
		/\u0000(\d+)\u0000/g,
		(_, index: string) => held[Number(index)] ?? "",
	)
}
export function highlightCode(source: string) {
	let held: string[] = []
	function hold(value: string, kind: string) {
		held.push(`<span class="token-${kind}">${escape(value)}</span>`)
		return `\ue000h${held.length - 1}h\ue000`
	}
	let text = source.replace(
		/\/\*[\s\S]*?\*\/|\/\/[^\n]*|(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
		value =>
			hold(
				value,
				value.startsWith("//") || value.startsWith("/*") ? "comment" : "string",
			),
	)
	text = escape(text)
		.replace(
			/\b(?:function|let|const|var|return|if|else|for|while|class|interface|type|export|import|from|async|await|new|throw|try|catch|def|print|True|False|None|true|false|null|undefined|select|where|insert|update|delete|as)\b/g,
			value => hold(value, "keyword"),
		)
		.replace(/\b\d+(?:\.\d+)?\b/g, value => hold(value, "number"))
	return text.replace(
		/\ue000h(\d+)h\ue000/g,
		(_, index: string) => held[Number(index)] ?? "",
	)
}
export function markdown(source: string): string {
	let references = new Map<string, string>(),
		lines = frontmatter(source)
			.body.replaceAll("\r\n", "\n")
			.split("\n")
			.filter(line => {
				let match = line.match(/^\s*\[([^\]]+)\]:\s*(\S+)/)
				if (match) {
					references.set((match[1] ?? "").toLowerCase(), match[2] ?? "")
					return false
				}
				return true
			}),
		html: string[] = [],
		index = 0
	function render(text: string) {
		return inline(text, references)
	}
	function isBlock(line: string) {
		return /^\s*(?:#{1,6}\s|`{3,}|~{3,}|>|[-+*]\s|\d+[.)]\s|---+\s*$)/.test(
			line,
		)
	}
	while (index < lines.length) {
		let line = lines[index] ?? ""
		if (!line.trim()) {
			index++
			continue
		}
		let fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
		if (fence) {
			let delimiter = fence[1] ?? "```",
				code: string[] = []
			index++
			while (
				index < lines.length &&
				!new RegExp(`^\\s*${delimiter[0]}{${delimiter.length},}\\s*$`).test(
					lines[index] ?? "",
				)
			) {
				code.push(lines[index] ?? "")
				index++
			}
			index++
			html.push(
				`<pre data-language="${escape((fence[2] ?? "").trim())}"><code>${highlightCode(code.join("\n"))}</code></pre>`,
			)
			continue
		}
		let heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/)
		if (heading) {
			let level = heading[1]?.length ?? 1
			html.push(
				`<h${level}>${render((heading[2] ?? "").replace(/\s+#+\s*$/, ""))}</h${level}>`,
			)
			index++
			continue
		}
		if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
			html.push("<hr>")
			index++
			continue
		}
		if (/^\s*>/.test(line)) {
			let quote: string[] = []
			while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
				quote.push((lines[index] ?? "").replace(/^\s*>\s?/, ""))
				index++
			}
			html.push(`<blockquote>${markdown(quote.join("\n"))}</blockquote>`)
			continue
		}
		if (
			line.includes("|") &&
			/^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? "")
		) {
			let cells = (row: string) =>
				row
					.trim()
					.replace(/^\||\|$/g, "")
					.split("|")
					.map(value => render(value.trim()))
			html.push(
				`<table><thead><tr>${cells(line)
					.map(value => `<th>${value}</th>`)
					.join("")}</tr></thead><tbody>`,
			)
			index += 2
			while (index < lines.length && lines[index]?.includes("|")) {
				html.push(
					`<tr>${cells(lines[index] ?? "")
						.map(value => `<td>${value}</td>`)
						.join("")}</tr>`,
				)
				index++
			}
			html.push("</tbody></table>")
			continue
		}
		let bullet = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/)
		if (bullet) {
			let indent = bullet[1]?.length ?? 0,
				tag = /\d/.test(bullet[2] ?? "") ? "ol" : "ul",
				start = parseInt(bullet[2] ?? "1") || 1
			html.push(`<${tag}${tag === "ol" ? ` start="${start}"` : ""}>`)
			while (index < lines.length) {
				let match = (lines[index] ?? "").match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/)
				if (
					!match ||
					(match[1]?.length ?? 0) !== indent ||
					(/\d/.test(match[2] ?? "") ? "ol" : "ul") !== tag
				)
					break
				let body = [match[3] ?? ""]
				index++
				while (index < lines.length) {
					let next = lines[index] ?? "",
						space = next.match(/^\s*/)?.[0].length ?? 0
					if (!next.trim()) {
						if ((lines[index + 1]?.match(/^\s*/)?.[0].length ?? 0) > indent) {
							body.push("")
							index++
							continue
						}
						break
					}
					if (space <= indent) break
					body.push(next.slice(Math.min(space, indent + 2)))
					index++
				}
				let task = (body[0] ?? "").match(/^\[([ xX])\]\s+(.*)$/)
				if (task) body[0] = task[2] ?? ""
				html.push(
					`<li${task ? ' class="task"' : ""}>${task ? `<input type="checkbox" disabled ${task[1]?.toLowerCase() === "x" ? "checked" : ""}>` : ""}${markdown(body.join("\n"))}</li>`,
				)
			}
			html.push(`</${tag}>`)
			continue
		}
		if (/^( {4}|\t)/.test(line)) {
			let code: string[] = []
			while (index < lines.length && /^( {4}|\t)/.test(lines[index] ?? "")) {
				code.push((lines[index] ?? "").replace(/^( {4}|\t)/, ""))
				index++
			}
			html.push(`<pre><code>${highlightCode(code.join("\n"))}</code></pre>`)
			continue
		}
		if (/^\s*(=+|-+)\s*$/.test(lines[index + 1] ?? "")) {
			let level = (lines[index + 1] ?? "").trim().startsWith("=") ? 1 : 2
			html.push(`<h${level}>${render(line)}</h${level}>`)
			index += 2
			continue
		}
		let paragraph = [line]
		index++
		while (
			index < lines.length &&
			(lines[index] ?? "").trim() &&
			!isBlock(lines[index] ?? "")
		) {
			paragraph.push(lines[index] ?? "")
			index++
		}
		html.push(
			`<p>${render(paragraph.join("\n"))
				.replace(/ {2}\n/g, "<br>")
				.replaceAll("\n", " ")}</p>`,
		)
	}
	return html.join("\n")
}
function nextFence(current: string, line: string) {
	if (current)
		return new RegExp(`^\\s*${current[0]}{${current.length},}\\s*$`).test(line)
			? ""
			: current
	return line.match(/^\s*(`{3,}|~{3,})/)?.[1] ?? ""
}
export function slideBlocks(source: string) {
	let blocks: string[] = [],
		current: string[] = [],
		fence = ""
	for (let line of source.split("\n")) {
		fence = nextFence(fence, line)
		if (!line.trim() && !fence) {
			if (current.length) {
				blocks.push(current.join("\n"))
				current = []
			}
		} else current.push(line)
	}
	if (current.length) blocks.push(current.join("\n"))
	return blocks
}
export function slides(source: string): Slide[] {
	let sections: string[][] = [[]],
		fence = ""
	for (let line of frontmatter(source).body.split("\n")) {
		fence = nextFence(fence, line)
		if (!fence && /^---\s*$/.test(line)) sections.push([])
		else sections[sections.length - 1]?.push(line)
	}
	return sections
		.filter(section => section.join("").trim())
		.map(section => {
			let content: string[] = [],
				notes: string[] = [],
				fence = ""
			for (let line of section) {
				let previous = fence
				fence = nextFence(fence, line)
				if (previous || fence) {
					content.push(line)
					continue
				}
				if (/^#{1,6}\s|^\s*!\[|^\s*\||^(\t| {2,})/.test(line))
					content.push(line.replace(/^(\t| {2})/, ""))
				else if (!line.trim()) {
					content.push("")
					notes.push("")
				} else notes.push(line)
			}
			return { content: content.join("\n"), notes: notes.join("\n") }
		})
}
export function compileTheme(source: string) {
	let css: string[] = [],
		document = "",
		slide = ""
	let metadata: ThemeMetadata = { name: "", presets: [] }
	let assets = new Map<string, string>()
	let lines = source.replaceAll("\r\n", "\n").split("\n")
	for (let index = 0; index < lines.length; index++) {
		let opening = (lines[index] ?? "").match(/^(`{3,}|~{3,})(.*)$/)
		if (!opening) continue
		let fence = opening[1] ?? "```",
			kind = (opening[2] ?? "").trim(),
			start = index + 1
		let content: string[] = []
		index++
		while (
			index < lines.length &&
			nextFence(fence, lines[index] ?? "") !== ""
		) {
			content.push(lines[index] ?? "")
			index++
		}
		if (
			![
				"css theme",
				"html document",
				"html slide",
				"json theme metadata",
			].includes(kind) &&
			!kind.startsWith("base64 asset ")
		)
			continue
		if (index === lines.length)
			throw new Error(`Unclosed ${kind} fence at line ${start}`)
		let body = content.join("\n")
		if (kind === "css theme") css.push(body)
		else if (kind === "html document") {
			if (document)
				throw new Error(`Duplicate document template at line ${start}`)
			document = body
		} else if (kind === "html slide") {
			if (slide) throw new Error(`Duplicate slide template at line ${start}`)
			slide = body
		} else if (kind.startsWith("base64 asset ")) {
			let [, , path = "", mime = ""] = kind.split(" ")
			if (
				!/^[\w./-]+$/.test(path) ||
				path.split("/").includes("..") ||
				path.startsWith("/")
			)
				throw new Error(`Invalid asset path at line ${start}`)
			if (
				!/^(font\/[\w.+-]+|image\/(png|jpeg|gif|webp|avif|svg\+xml)|application\/(font-woff|octet-stream))$/.test(
					mime,
				)
			)
				throw new Error(`Unsupported theme asset type at line ${start}`)
			let base64 = body.replace(/\s/g, "")
			if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
				throw new Error(`Invalid base64 at line ${start}`)
			try {
				atob(base64)
			} catch {
				throw new Error(`Invalid base64 at line ${start}`)
			}
			if (assets.has(path)) throw new Error(`Duplicate asset at line ${start}`)
			assets.set(path, `data:${mime};base64,${base64}`)
		} else {
			try {
				metadata = themeMetadata(JSON.parse(body))
			} catch {
				throw new Error(`Invalid theme metadata at line ${start}`)
			}
		}
	}
	for (let template of [document, slide]) {
		if (
			template &&
			(template.match(/data-(content|document)(?=[\s=>])/g)?.length ?? 0) !== 1
		)
			throw new Error("A template needs exactly one data-content slot")
	}
	function portable(text: string) {
		return text.replace(/asset:([\w./-]+)/g, (_, path: string) => {
			let asset = assets.get(path)
			if (!asset) throw new Error(`Missing theme asset: ${path}`)
			return asset
		})
	}
	return {
		metadata,
		css: portable(css.join("\n")),
		document: portable(document),
		slide: portable(slide),
	}
}
