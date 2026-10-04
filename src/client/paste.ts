import { safeUrl } from "../shared/markdown"

export function pasteMarkdown(plain: string, rich = "", selected = "") {
	let url = /^(https?:\/\/|mailto:)/i.test(plain.trim())
		? safeUrl(plain.trim())
		: ""
	if (selected && url) return `[${selected.replace(/\]/g, "\\]")}](${url})`
	if (!rich) return plain
	let document = new DOMParser().parseFromString(rich, "text/html")
	return (
		[...document.body.childNodes]
			.map(node => render(node))
			.join("")
			.replace(/\n{3,}/g, "\n\n")
			.trim() || plain
	)

	function render(node: Node, depth = 0): string {
		if (depth > 64) return node.textContent ?? ""
		if (node.nodeType === Node.TEXT_NODE)
			return (node.textContent ?? "").replace(/\s+/g, " ")
		if (!(node instanceof Element)) return ""
		let content = () =>
			[...node.childNodes].map(child => render(child, depth + 1)).join("")
		let tag = node.tagName.toLowerCase()
		if (
			[
				"script",
				"style",
				"iframe",
				"object",
				"svg",
				"canvas",
				"noscript",
			].includes(tag)
		)
			return ""
		if (/^h[1-6]$/.test(tag))
			return (
				"\n\n" + "#".repeat(Number(tag[1])) + " " + content().trim() + "\n\n"
			)
		if (["p", "div", "section", "article"].includes(tag))
			return "\n\n" + content().trim() + "\n\n"
		if (tag === "br") return "  \n"
		if (tag === "hr") return "\n\n---\n\n"
		if (["strong", "b"].includes(tag)) return "**" + content() + "**"
		if (["em", "i"].includes(tag)) return "*" + content() + "*"
		if (["s", "del"].includes(tag)) return "~~" + content() + "~~"
		if (tag === "pre") {
			let source = node.textContent ?? "",
				fence = "`".repeat(
					Math.max(
						3,
						...[...source.matchAll(/`+/g)].map(match => match[0].length + 1),
					),
				)
			let language =
				node.querySelector("code")?.className.match(/language-([\w-]+)/)?.[1] ??
				""
			return `\n\n${fence}${language}\n${source.trimEnd()}\n${fence}\n\n`
		}
		if (tag === "code") {
			let source = node.textContent ?? "",
				fence = source.includes("`") ? "``" : "`"
			return fence + source + fence
		}
		if (tag === "a") {
			let href = safeUrl(node.getAttribute("href") ?? "")
			return href ? `[${content()}](${href})` : content()
		}
		if (tag === "img") {
			let src = safeUrl(node.getAttribute("src") ?? "")
			return src ? `![${node.getAttribute("alt") ?? ""}](${src})` : ""
		}
		if (tag === "blockquote")
			return (
				"\n\n" +
				content()
					.trim()
					.split("\n")
					.map(line => "> " + line)
					.join("\n") +
				"\n\n"
			)
		if (tag === "ul" || tag === "ol")
			return (
				"\n\n" +
				[...node.children]
					.filter(child => child.tagName === "LI")
					.map((child, index) => {
						let text = render(child, depth + 1)
							.trim()
							.replace(/\n/g, "\n  ")
						return (tag === "ol" ? `${index + 1}. ` : "- ") + text
					})
					.join("\n") +
				"\n\n"
			)
		if (tag === "table") {
			let rows = [...node.querySelectorAll("tr")].map(row =>
				[...row.children].map(cell =>
					render(cell, depth + 1)
						.trim()
						.replace(/\|/g, "\\|")
						.replace(/\n/g, " "),
				),
			)
			let first = rows[0]
			if (!first) return ""
			rows.splice(
				1,
				0,
				first.map(() => "---"),
			)
			return (
				"\n\n" +
				rows.map(row => "| " + row.join(" | ") + " |").join("\n") +
				"\n\n"
			)
		}
		return content()
	}
}
