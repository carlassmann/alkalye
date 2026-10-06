import { lineBounds } from "./lines"
import { nextFence } from "./markdown"
export interface Selection {
	start: number
	end: number
}
export let formattingCommands: readonly string[] = [
	"bold",
	"italic",
	"code",
	"heading",
	"bullet",
	"task",
	"link",
	"quote",
	"ordered",
	"strike",
	"clear",
	"complete",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
]
export function formatSelection(
	source: string,
	selection: Selection,
	command: string,
) {
	let { start, end } = selection
	if (command === "image") {
		let alt = source.slice(start, end) || "alt"
		let markup = `![${alt}](url)`
		let urlStart = start + alt.length + 4
		return {
			source: source.slice(0, start) + markup + source.slice(end),
			selection: { start: urlStart, end: urlStart + 3 },
		}
	}
	if (command === "clear") {
		if (start === end) {
			while (start > 0 && /[\p{L}\p{N}_]/u.test(source[start - 1] ?? ""))
				start--
			while (end < source.length && /[\p{L}\p{N}_]/u.test(source[end] ?? ""))
				end++
			if (start === end) ({ start, end } = lineBounds(source, selection))
		}
		let selected = source.slice(start, end),
			plain = plainInline(selected)
		return {
			source: source.slice(0, start) + plain + source.slice(end),
			selection:
				plain === selected ? selection : { start, end: start + plain.length },
		}
	}
	let wrappers: Record<string, [string, string]> = {
		bold: ["**", "**"],
		italic: ["*", "*"],
		code: ["`", "`"],
		strike: ["~~", "~~"],
		link: ["[", "](https://)"],
	}
	let wrapper = wrappers[command]
	if (wrapper) {
		if (start === end) {
			while (start > 0 && /[\p{L}\p{N}_]/u.test(source[start - 1] ?? ""))
				start--
			while (end < source.length && /[\p{L}\p{N}_]/u.test(source[end] ?? ""))
				end++
		}
		let selected = source.slice(start, end),
			before = source.slice(0, start),
			after = source.slice(end)
		if (before.endsWith(wrapper[0]) && after.startsWith(wrapper[1]))
			return {
				source:
					before.slice(0, -wrapper[0].length) +
					selected +
					after.slice(wrapper[1].length),
				selection: {
					start: start - wrapper[0].length,
					end: end - wrapper[0].length,
				},
			}
		if (selected.startsWith(wrapper[0]) && selected.endsWith(wrapper[1]))
			return {
				source:
					before +
					selected.slice(wrapper[0].length, -wrapper[1].length) +
					after,
				selection: { start, end: end - wrapper[0].length - wrapper[1].length },
			}
		return {
			source: before + wrapper[0] + selected + wrapper[1] + after,
			selection: {
				start: start + wrapper[0].length,
				end: end + wrapper[0].length,
			},
		}
	}
	let bounds = lineBounds(source, { start, end })
	start = bounds.start
	end = bounds.end
	let lines = source.slice(start, end).split("\n")
	let prefix =
		command.startsWith("h") && /^h[1-6]$/.test(command)
			? "#".repeat(Number(command.slice(1))) + " "
			: command === "heading"
				? "## "
				: command === "bullet"
					? "- "
					: command === "task"
						? "- [ ] "
						: command === "quote"
							? "> "
							: command === "ordered"
								? "1. "
								: ""
	let remove = lines.every(line => line.trimStart().startsWith(prefix))
	let checkAll = lines.some(line => /^\s*[-*+]\s+\[ \]/.test(line))
	let offsets: { start: number; removed: number; inserted: number }[] = []
	let offset = start
	let transformed = lines
		.map((line, index) => {
			let indent = line.match(/^[ \t]*/)?.[0] ?? ""
			let body = line.slice(indent.length)
			if (command === "complete")
				return line.replace(
					/^(\s*[-*+]\s+)\[[ xX]\]/,
					(_, prefix: string) => prefix + (checkAll ? "[x]" : "[ ]"),
				)
			let previous =
				body.match(
					/^(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/,
				)?.[0] ?? ""
			let next =
				command === "body" || remove
					? ""
					: command === "ordered"
						? `${index + 1}. `
						: prefix
			offsets.push({
				start: offset + indent.length,
				removed: previous.length,
				inserted: next.length,
			})
			offset += line.length + 1
			return indent + next + body.slice(previous.length)
		})
		.join("\n")
	function mapped(position: number) {
		let shift = 0
		for (let edit of offsets) {
			if (position < edit.start) break
			if (position < edit.start + edit.removed)
				return edit.start + shift + edit.inserted
			shift += edit.inserted - edit.removed
		}
		return position + shift
	}
	return {
		source: source.slice(0, start) + transformed + source.slice(end),
		selection: { start: mapped(selection.start), end: mapped(selection.end) },
	}
}

function plainInline(source: string): string {
	let held: string[] = [],
		occupied = new Set(source),
		delimiter: string | undefined
	for (let point = 0xe000; point <= 0xf8ff; point++) {
		let candidate = String.fromCharCode(point)
		if (!occupied.has(candidate)) {
			delimiter = candidate
			break
		}
	}
	if (!delimiter) return source
	let placeholder = new RegExp(`${delimiter}(\\d+)${delimiter}`, "g")
	function hold(text: string) {
		held.push(text)
		return `${delimiter}${held.length - 1}${delimiter}`
	}
	let text = source.replace(/\\[\\`*{}\[\]()#+.!_>~=-]/g, match => hold(match))
	text = text.replace(
		/(`+)([\s\S]*?)\1/g,
		(_match, _marker: string, content: string) => hold(content),
	)
	let result = ""
	for (let index = 0; index < text.length; index++) {
		let image = text[index] === "!" && text[index + 1] === "["
		let open = image ? index + 1 : index
		if (text[open] === "[" && text[open + 1] !== "[") {
			let close = closingDelimiter(text, open, "[", "]")
			let destination =
				close >= 0 && text[close + 1] === "("
					? closingDelimiter(text, close + 1, "(", ")")
					: -1
			if (destination >= 0) {
				result += plainInline(text.slice(open + 1, close))
				index = destination
				continue
			}
		}
		result += text[index]
	}
	text = result
	for (let previous = ""; previous !== text;) {
		previous = text
		text = text
			.replace(/(\*\*|__|~~|==)(?=\S)([\s\S]*?\S)\1/g, "$2")
			.replace(/\*([^*\n]+)\*/g, "$1")
			.replace(/(^|[^\p{L}\p{N}_])_([^_\n]+)_(?=[^\p{L}\p{N}_]|$)/gu, "$1$2")
	}
	for (let pass = 0; pass <= held.length; pass++) {
		let restored = text.replace(
			placeholder,
			(match, index: string) => held[Number(index)] ?? match,
		)
		if (restored === text) break
		text = restored
	}
	return text
}
function closingDelimiter(
	source: string,
	start: number,
	open: string,
	close: string,
) {
	let depth = 0
	for (let index = start; index < source.length; index++) {
		if (source[index] === open) depth++
		if (source[index] === close && --depth === 0) return index
	}
	return -1
}

export function sortTasks(source: string): string {
	let lines = source.split("\n"),
		result: string[] = [],
		fence = ""
	for (let index = 0; index < lines.length; index++) {
		let line = lines[index] ?? ""
		let previousFence = fence
		fence = nextFence(fence, line)
		let task = line.match(/^(\s*)[-*+] \[([ xX])\]/)
		if (fence || previousFence || !task) {
			result.push(line)
			continue
		}
		let indent = task[1]?.length ?? 0,
			blocks: { done: boolean; lines: string[] }[] = []
		while (index < lines.length) {
			let current = lines[index] ?? "",
				match = current.match(/^(\s*)[-*+] \[([ xX])\]/)
			if (!match || (match[1]?.length ?? 0) !== indent) break
			let block = { done: match[2] !== " ", lines: [current] }
			index++
			while (
				index < lines.length &&
				/^\s+\S/.test(lines[index] ?? "") &&
				(lines[index]?.match(/^\s*/)?.[0].length ?? 0) > indent
			) {
				block.lines.push(lines[index] ?? "")
				index++
			}
			blocks.push(block)
		}
		for (let block of blocks.sort((a, b) => Number(a.done) - Number(b.done))) {
			result.push(block.lines[0] ?? "")
			if (block.lines.length > 1)
				result.push(...sortTasks(block.lines.slice(1).join("\n")).split("\n"))
		}
		index--
	}
	return result.join("\n")
}

export function removeAsset(source: string, id: string) {
	return source.replace(
		/!\[(?:\\.|[^\]\\])*\]\(asset:([\w:.-]+)(?:\s+"[^"]*")?\)/g,
		(link: string, asset: string) => (asset === id ? "" : link),
	)
}

export function assetReferences(source: string) {
	return new Set(
		[...source.matchAll(/asset:([\w:.-]+)/gi)].map(match => match[1] ?? ""),
	)
}
