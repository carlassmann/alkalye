import { type Extension, RangeSetBuilder } from "@codemirror/state"
import {
	EditorView,
	Decoration,
	type DecorationSet,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view"
import { syntaxTree } from "@codemirror/language"

export { createLinkDecorations }

function createLinkDecorations(): Extension {
	let decorationPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view)
			}

			update(update: ViewUpdate) {
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.selectionSet
				) {
					this.decorations = this.buildDecorations(update.view)
				}
			}

			buildDecorations(view: EditorView): DecorationSet {
				let builder = new RangeSetBuilder<Decoration>()
				let links = parseLinks(view)
				let selection = view.state.selection.main

				for (let link of links) {
					// Don't decorate if cursor is inside the link
					if (selection.from >= link.from && selection.to <= link.to) {
						continue
					}

					let widget = Decoration.replace({
						widget: new LinkWidget(link.text, link.url),
					})
					builder.add(link.from, link.to, widget)
				}

				return builder.finish()
			}
		},
		{
			decorations: v => v.decorations,
		},
	)

	let theme = EditorView.baseTheme({
		".cm-md-link": {
			cursor: "pointer",
			textDecoration: "underline",
			textDecorationColor: "var(--muted-foreground)",
			display: "inline-flex",
			alignItems: "center",
			gap: "2px",
			verticalAlign: "baseline",
		},
		".cm-md-link:hover": {
			textDecorationColor: "currentColor",
		},
		".cm-md-link-icon": {
			flexShrink: "0",
			verticalAlign: "middle",
			opacity: "0.5",
		},
	})

	return [decorationPlugin, theme]
}

// Helpers

class LinkWidget extends WidgetType {
	text: string
	url: string

	constructor(text: string, url: string) {
		super()
		this.text = text
		this.url = url
	}

	toDOM() {
		let link = document.createElement("a")
		link.className = "cm-md-link"
		link.href = this.url
		link.target = "_blank"
		link.rel = "noopener noreferrer"

		// Add icon (link from lucide)
		let icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
		icon.setAttribute("width", "14")
		icon.setAttribute("height", "14")
		icon.setAttribute("viewBox", "0 0 24 24")
		icon.setAttribute("fill", "none")
		icon.setAttribute("stroke", "currentColor")
		icon.setAttribute("stroke-width", "2")
		icon.setAttribute("stroke-linecap", "round")
		icon.setAttribute("stroke-linejoin", "round")
		icon.classList.add("cm-md-link-icon")
		icon.innerHTML = `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`

		link.appendChild(icon)
		link.appendChild(document.createTextNode(this.text))

		link.addEventListener("mousedown", e => {
			e.preventDefault()
			e.stopPropagation()
		})

		return link
	}

	eq(other: LinkWidget) {
		return this.text === other.text && this.url === other.url
	}

	ignoreEvent(e: Event) {
		return e.type === "mousedown" || e.type === "click"
	}
}

interface LinkMatch {
	from: number
	to: number
	text: string
	url: string
}

function parseLinks(view: EditorView): LinkMatch[] {
	let links: LinkMatch[] = []
	let tree = syntaxTree(view.state)

	for (let { from, to } of view.visibleRanges) {
		tree.iterate({
			from,
			to,
			enter: node => {
				if (node.name === "Link") {
					let urlNode = node.node.getChild("URL")
					if (!urlNode) return

					let url = view.state.sliceDoc(urlNode.from, urlNode.to)
					// Skip asset: links (handled by image decorations)
					if (url.startsWith("asset:")) return

					let linkContent = view.state.sliceDoc(node.from, node.to)
					let match = linkContent.match(/^\[([^\]]*)\]/)
					let text = match?.[1] || "Web Link"

					links.push({
						from: node.from,
						to: node.to,
						text,
						url,
					})
				}
			},
		})
	}

	return links
}
