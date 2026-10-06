import { html, localizeMarkup, rawMarkup } from "../language"
import { icon } from "../icons"
import type { IconName } from "../icons"
import { escape, frontmatterBlock, nextFence } from "../../shared/markdown"
import { iconPrefix } from "../../shared/projection"
import type { ProjectedLink } from "../../shared/projection"
import type { DocumentLink } from "../../shared/model"
export function sourceHighlight(
	source: string,
	documents: readonly DocumentLink[] = [],
	links: readonly ProjectedLink[] = [],
	mediaIcon?: (target: string) => IconName,
) {
	let offset = 0
	let headerEnd = frontmatterBlock(source)?.[0].length ?? 0
	let fence = ""
	return (
		source
			.split("\n")
			.map(line => {
				let start = offset
				offset += line.length + 1
				let collapsed = links.filter(
					link => link.view.start >= start && link.view.end <= offset - 1,
				)
				let previousFence = fence
				if (start >= headerEnd) fence = nextFence(fence, line)
				let literal =
					start < headerEnd ||
					Boolean(previousFence) ||
					Boolean(fence) ||
					/^( {4}|\t)/.test(line)
				return highlightLine(
					line,
					start,
					collapsed,
					literal,
					documents,
					mediaIcon,
				)
			})
			.join("\n") + "\n"
	)
}
export function highlightLine(
	line: string,
	start: number,
	links: readonly ProjectedLink[],
	literal: boolean,
	documents: readonly DocumentLink[],
	mediaIcon?: (target: string) => IconName,
) {
	let content = lineMarkup(
		line,
		start,
		links,
		literal ? undefined : documents,
		mediaIcon,
	)
	if (/^---\s*$|^\s*(`{3,}|~{3,})/.test(line))
		return html`<span class="syntax-marker">${rawMarkup(content)}</span>`
	if (literal) return content
	if (/^\s*[-*+] \[x\]/i.test(line))
		return html`<span class="done-task">${rawMarkup(content)}</span>`
	let heading = content.match(/^(#{1,6})(\s.*)$/)
	if (heading)
		return html`<span class="syntax-heading"
			><span class="syntax-marker">${heading[1] ?? ""}</span
			>${rawMarkup(heading[2] ?? "")}</span
		>`
	if (/^>/.test(line))
		return html`<span class="syntax-quote">${rawMarkup(content)}</span>`
	return content
}
// Hold projected links aside so inline patterns cannot modify their attributes.
function lineMarkup(
	line: string,
	start: number,
	links: readonly ProjectedLink[],
	documents?: readonly DocumentLink[],
	mediaIcon?: (target: string) => IconName,
) {
	let content = "",
		position = 0
	let heldLinks: string[] = []
	for (let link of [...links, undefined]) {
		let raw = escape(
			line.slice(position, link ? link.view.start - start : undefined),
		)
		content += raw
		if (!link) break
		let name: IconName =
			link.kind === "wiki"
				? link.broken
					? "file-warning"
					: "file-symlink"
				: link.kind === "media"
					? (mediaIcon?.(link.target) ?? "image")
					: "link"
		let label = line.slice(
			link.view.start - start + (link.iconSpace ? iconPrefix.length : 0),
			link.view.end - start,
		)
		heldLinks.push(
			html`<span
				class="${link.broken ? "syntax-link syntax-link-broken" : "syntax-link"}"
				data-editor-link="${link.source.start}"
				title="${link.target}"
				>${link.iconSpace ? html`<span class="syntax-link-icon" data-icon="${name}" aria-hidden="true">${iconPrefix}${icon(name)}</span>` : ""}<span
					class="syntax-link-label"
					>${label}</span
				></span
			>`.value,
		)
		content += `\u0001${heldLinks.length - 1}\u0001`
		position = link.view.end - start
	}
	return (documents ? decorate(content, documents) : content).replace(
		/\u0001(\d+)\u0001/g,
		(_, index: string) => heldLinks[Number(index)] ?? "",
	)
}
function decorate(content: string, documents: readonly DocumentLink[]) {
	let held: string[] = []
	let protectedContent = content.replace(/\\.|(`+)[\s\S]*?\1/g, value => {
		held.push(
			value.startsWith("`")
				? html`<span class="syntax-code">${rawMarkup(value)}</span>`.value
				: value,
		)
		return `\u0000${held.length - 1}\u0000`
	})
	return protectedContent
		.replace(
			/(?<!=)==(?!=)(?=\S)(.*?\S)(?<!=)==(?!=)/g,
			localizeMarkup(
				'<span class="syntax-highlight"><span class="syntax-marker">==</span>$1<span class="syntax-marker">==</span></span>',
			),
		)
		.replace(
			/\*\*(.+?)\*\*/g,
			localizeMarkup(
				'<span class="syntax-bold"><span class="syntax-marker">**</span>$1<span class="syntax-marker">**</span></span>',
			),
		)
		.replace(/(\[\[.*?\]\])/g, (value: string) => {
			let token = value.slice(2, -2).split("|")[0]
			let doc = documents.find(doc => doc.id === token || doc.title === token)
			return html`<span class="syntax-link" title="${doc?.title ?? token}"
				>${rawMarkup(value)}</span
			>`.value
		})
		.replace(
			/\u0000(\d+)\u0000/g,
			(_, index: string) => held[Number(index)] ?? "",
		)
}
