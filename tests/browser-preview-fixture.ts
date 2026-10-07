import {
	renderPreview,
	previewCommentSelection,
	disposePreview,
} from "../src/client/components/preview"
import { clearDocument } from "../src/client/components/document-renderer"
import { Replica } from "../src/shared/crdt"
import type { PreviewComments } from "../src/client/components/preview"
import { selectionAnchor } from "../src/shared/documents"
import { performanceFixture } from "../experiments/performance/fixture"

declare global {
	interface Window {
		runPreviewChecks(): string[]
	}
}
window.runPreviewChecks = runPreviewChecks

function runPreviewChecks() {
	let checks: string[] = []
	function check(value: boolean, message: string) {
		if (!value) throw new Error(message)
		checks.push(message)
	}
	let host = document.createElement("div")
	document.body.append(host)
	let source =
		"foo *bar* tail\n\nA [safe link](https://example.com) and ==marker==.\n\n😀 repeated repeated\n\n[[related|Related note]]"
	let replica = new Replica("preview-contract")
	replica.edit("document", source)
	let selected: string[] = []
	let comments: PreviewComments = {
		comments: [],
		commentable: true,
		select: id => selected.push(id),
	}
	try {
		renderPreview(
			host,
			source,
			{},
			id => selected.push(id),
			undefined,
			comments,
		)
		check(
			host.shadowRoot?.querySelector("a[href='https://example.com']")
				?.textContent === "safe link",
			"Preview renders safe Markdown links",
		)
		check(
			host.shadowRoot?.querySelector("mark")?.textContent === "marker",
			"Preview keeps text-marker highlighting",
		)
		selectText(host, "repeated", 1)
		let selection = previewCommentSelection(
			host,
			replica.visible("document"),
			source,
		)
		let position = source.lastIndexOf("repeated")
		check(
			selection?.anchor ===
				selectionAnchor(
					replica.visible("document"),
					source,
					"repeated",
					position,
				).anchor,
			"Lazy preview selection anchors the correct repeated source occurrence",
		)
		let tail = source.indexOf("tail")
		comments.comments = [
			{ id: "foo", fields: { resolved: "false" }, range: { start: 0, end: 3 } },
			{
				id: "tail",
				fields: { resolved: "false" },
				range: { start: tail, end: tail + 4 },
			},
		]
		comments.selected = "foo"
		let scrolls = 0
		let scroll = Element.prototype.scrollIntoView
		Element.prototype.scrollIntoView = () => {
			scrolls++
		}
		try {
			renderPreview(host, source, {}, () => {}, undefined, comments)
			check(
				host.shadowRoot?.querySelector("mark[data-comment-id=foo]")
					?.textContent === "foo" &&
					host.shadowRoot?.querySelector("mark[data-comment-id=tail]")
						?.textContent === "tail",
				"Two comment ranges survive whitespace splitting before an inline element",
			)
			selectText(host, "tail")
			check(
				previewCommentSelection(host, replica.visible("document"), source)
					?.anchor ===
					selectionAnchor(replica.visible("document"), source, "tail", tail)
						.anchor,
				"Selections after marked whitespace retain exact source anchors",
			)
			let previous = scrolls
			renderPreview(
				host,
				source,
				{ appearance: "dark" },
				() => {},
				undefined,
				comments,
			)
			check(
				scrolls === previous,
				"Changing preview appearance does not reveal an already selected comment again",
			)
		} finally {
			Element.prototype.scrollIntoView = scroll
		}
		let marked = host.shadowRoot?.querySelector("mark[data-comment-id=tail]")
		marked?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		)
		check(
			selected.includes("tail"),
			"Comment highlights retain keyboard activation",
		)
		comments.comments = [
			{
				id: "tail",
				fields: { resolved: "true" },
				range: { start: tail, end: tail + 4 },
			},
		]
		renderPreview(host, source, {}, () => {}, undefined, comments)
		check(
			host.shadowRoot
				?.querySelector("mark[data-comment-id=tail]")
				?.classList.contains("preview-comment-range-resolved") === true,
			"Resolved comment highlights retain their state",
		)
		let theme =
			"```html document\n<section><script>window.previewUnsafe=true</script><article data-content onclick=alert(1)></article></section>\n```"
		renderPreview(host, source, { theme }, () => {}, undefined, {
			comments: [],
			commentable: true,
		})
		check(
			!host.shadowRoot?.querySelector("script,[onclick]") &&
				host.shadowRoot
					?.querySelector("[data-content]")
					?.textContent?.includes("Related note") === true,
			"Theme templates remain sanitized while content and wiki labels render",
		)
		let large = performanceFixture(128) + "\n\nA unique closing passage."
		renderPreview(host, large, {}, () => {}, undefined, {
			comments: [],
			commentable: true,
		})
		check(
			(host.shadowRoot?.querySelectorAll("a").length ?? 0) > 1200 &&
				host.shadowRoot
					?.querySelector("[data-content]")
					?.textContent?.includes("responsiveness") === true,
			"Large previews render their complete Markdown without eager comment work",
		)
		selectText(host, "unique closing passage")
		let closing = large.indexOf("unique closing passage")
		check(
			previewCommentSelection(host, [], large)?.anchor ===
				selectionAnchor([], large, "unique closing passage", closing).anchor,
			"A selection at the end of a large preview retains its exact source context",
		)
		renderPreview(host, large, {}, () => {}, undefined, {
			comments: [
				{
					id: "closing",
					fields: {},
					range: { start: closing, end: closing + 22 },
				},
			],
			commentable: true,
		})
		check(
			host.shadowRoot?.querySelector("mark[data-comment-id=closing]")
				?.textContent === "unique closing passage",
			"A large preview marks a comment at the document end",
		)
		disposePreview(host)
		check(
			previewCommentSelection(host, [], large) === undefined,
			"Disposing a preview releases its selection state",
		)
		return checks
	} finally {
		disposePreview(host)
		clearDocument(host)
		host.remove()
		getSelection()?.removeAllRanges()
	}
}
function selectText(host: HTMLElement, text: string, occurrence = 0) {
	let content = host.shadowRoot?.querySelector("[data-content]")
	if (!content) throw new Error("Preview content missing")
	let walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!(node instanceof Text)) continue
		for (
			let start = node.data.indexOf(text);
			start >= 0;
			start = node.data.indexOf(text, start + text.length)
		) {
			if (occurrence-- > 0) continue
			getSelection()?.setBaseAndExtent(node, start, node, start + text.length)
			document.dispatchEvent(new Event("selectionchange"))
			return
		}
	}
	throw new Error("Preview selection text missing")
}
