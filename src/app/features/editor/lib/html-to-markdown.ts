export { htmlToMarkdown }

function htmlToMarkdown(html: string): string {
	let parsed = new DOMParser().parseFromString(html, "text/html")
	let markdown = convertChildren(parsed.body)
	return markdown
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
}

function convertNode(node: Node): string {
	if (node instanceof Text) return node.data.replace(/\s+/g, " ")
	if (!(node instanceof HTMLElement)) return convertChildren(node)

	let content = convertChildren(node).trim()
	switch (node.tagName.toLowerCase()) {
		case "h1":
		case "h2":
		case "h3":
		case "h4":
		case "h5":
		case "h6": {
			let level = Number(node.tagName[1])
			return `${"#".repeat(level)} ${content}\n\n`
		}
		case "p":
		case "div":
			return `${content}\n\n`
		case "br":
			return "\n"
		case "strong":
		case "b":
			return content ? `**${content}**` : ""
		case "em":
		case "i":
			return content ? `*${content}*` : ""
		case "del":
		case "s":
			return content ? `~~${content}~~` : ""
		case "code":
			if (node.parentElement?.tagName.toLowerCase() === "pre") return content
			return inlineCode(content)
		case "pre":
			return fencedCode(node.textContent ?? "")
		case "a": {
			let href = safeUrl(node.getAttribute("href"))
			return href ? `[${content || href}](${href})` : content
		}
		case "img": {
			let source = safeUrl(node.getAttribute("src"))
			let alt = node.getAttribute("alt") ?? "image"
			return source ? `![${alt}](${source})` : alt
		}
		case "blockquote":
			return `${content
				.split("\n")
				.map(line => `> ${line}`)
				.join("\n")}\n\n`
		case "ul":
			return convertList(node, false)
		case "ol":
			return convertList(node, true)
		case "li":
			return content
		case "hr":
			return "---\n\n"
		case "table":
			return convertTable(node)
		default:
			return convertChildren(node)
	}
}

function convertChildren(node: Node): string {
	return Array.from(node.childNodes).map(convertNode).join("")
}

function convertList(list: HTMLElement, ordered: boolean): string {
	let items = Array.from(list.children).filter(
		child =>
			child instanceof HTMLElement && child.tagName.toLowerCase() === "li",
	)
	let lines = items.map((item, index) => {
		let marker = ordered ? `${index + 1}. ` : "- "
		let content = convertChildren(item).trim()
		return marker + content.replace(/\n/g, "\n  ")
	})
	return `${lines.join("\n")}\n\n`
}

function convertTable(table: HTMLElement): string {
	let rows = Array.from(table.querySelectorAll("tr")).map(row =>
		Array.from(row.children).map(cell => (cell.textContent ?? "").trim()),
	)
	let width = Math.max(0, ...rows.map(row => row.length))
	if (rows.length === 0 || width === 0) return ""
	let normalized = rows.map(row => [
		...row,
		...Array.from({ length: width - row.length }, () => ""),
	])
	let header = normalized[0]
	let body = normalized.slice(1)
	return [
		`| ${header.join(" | ")} |`,
		`| ${header.map(() => "---").join(" | ")} |`,
		...body.map(row => `| ${row.join(" | ")} |`),
		"",
		"",
	].join("\n")
}

function inlineCode(content: string): string {
	let marker = "`".repeat(Math.max(1, longestRun(content, "`") + 1))
	let padding = content.startsWith("`") || content.endsWith("`") ? " " : ""
	return `${marker}${padding}${content}${padding}${marker}`
}

function fencedCode(content: string): string {
	let marker = "`".repeat(Math.max(3, longestRun(content, "`") + 1))
	return `${marker}\n${content.trimEnd()}\n${marker}\n\n`
}

function longestRun(content: string, character: string): number {
	let longest = 0
	let current = 0
	for (let value of content) {
		if (value === character) {
			current++
			longest = Math.max(longest, current)
		} else {
			current = 0
		}
	}
	return longest
}

function safeUrl(value: string | null): string {
	if (!value) return ""
	let trimmed = value.trim()
	if (/^(?:https?:|mailto:|tel:|#|\/)/i.test(trimmed)) return trimmed
	return ""
}
