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
	start = source.lastIndexOf("\n", start - 1) + 1
	let lineEnd = source.indexOf("\n", end)
	end = lineEnd < 0 ? source.length : lineEnd
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
	let remove = lines.every(line => line.startsWith(prefix))
	let transformed = lines
		.map((line, index) => {
			if (command === "complete")
				return line.replace(/\[([ xX])\]/, (_, checked: string) =>
					checked === " " ? "[x]" : "[ ]",
				)
			if (command === "clear")
				return line
					.replace(
						/^\s*(#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s+)/,
						"",
					)
					.replace(/(\*\*|__|~~|`|\*)(.+?)\1/g, "$2")
			let body = line.replace(
				/^\s*(#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s+)/,
				"",
			)
			return remove
				? body
				: (command === "ordered" ? `${index + 1}. ` : prefix) + body
		})
		.join("\n")
	return {
		source: source.slice(0, start) + transformed + source.slice(end),
		selection: { start, end: start + transformed.length },
	}
}
export function sortTasks(source: string): string {
	let lines = source.split("\n"),
		result: string[] = [],
		fence = false
	for (let index = 0; index < lines.length; index++) {
		let line = lines[index] ?? ""
		if (/^\s*```/.test(line)) fence = !fence
		let task = line.match(/^(\s*)[-*+] \[([ xX])\]/)
		if (fence || !task) {
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
