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
import { parseWikiLinks, type WikiLink } from "./wikilink-parser"

export { createWikilinkDecorations }
export type { WikilinkResolver }

type WikilinkResolver = (
	id: string,
) => { title: string; exists: boolean } | undefined

class WikilinkWidget extends WidgetType {
	id: string
	title: string
	exists: boolean
	onNavigate: (id: string, newTab: boolean) => void

	constructor(
		id: string,
		title: string,
		exists: boolean,
		onNavigate: (id: string, newTab: boolean) => void,
	) {
		super()
		this.id = id
		this.title = title
		this.exists = exists
		this.onNavigate = onNavigate
	}

	toDOM() {
		let span = document.createElement("span")
		span.className = this.exists
			? "cm-wikilink"
			: "cm-wikilink cm-wikilink-broken"

		// Add icon
		let icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
		icon.setAttribute("width", "14")
		icon.setAttribute("height", "14")
		icon.setAttribute("viewBox", "0 0 24 24")
		icon.setAttribute("fill", "none")
		icon.setAttribute("stroke", "currentColor")
		icon.setAttribute("stroke-width", "2")
		icon.setAttribute("stroke-linecap", "round")
		icon.setAttribute("stroke-linejoin", "round")
		icon.classList.add("cm-wikilink-icon")

		if (this.exists) {
			// file-symlink icon
			icon.innerHTML = `<path d="M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m10 18 3-3-3-3"/>`
		} else {
			// file-exclamation-point icon
			icon.innerHTML = `<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M12 9v4"/><path d="M12 17h.01"/>`
		}

		span.appendChild(icon)
		span.appendChild(document.createTextNode(this.title))
		span.dataset.docId = this.id

		span.addEventListener("mousedown", e => {
			// Prevent CodeMirror from placing cursor and removing decoration
			e.preventDefault()
			e.stopPropagation()
		})

		span.addEventListener("click", e => {
			e.preventDefault()
			e.stopPropagation()
			// Only navigate if doc exists
			if (this.exists) {
				this.onNavigate(this.id, e.ctrlKey || e.metaKey)
			}
		})

		return span
	}

	eq(other: WikilinkWidget) {
		return (
			this.id === other.id &&
			this.title === other.title &&
			this.exists === other.exists
		)
	}

	ignoreEvent(e: Event) {
		// Let our click handler run, not CodeMirror's
		return e.type === "mousedown" || e.type === "click"
	}
}

function createWikilinkDecorations(
	resolver: WikilinkResolver,
	onNavigate: (id: string, newTab: boolean) => void,
): Extension {
	let decorationPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet
			resolver: WikilinkResolver
			onNavigate: (id: string, newTab: boolean) => void

			constructor(view: EditorView) {
				this.resolver = resolver
				this.onNavigate = onNavigate
				this.decorations = this.buildDecorations(view)
			}

			update(update: ViewUpdate) {
				// Rebuild on any change - resolver may return different results
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
				let links = parseVisibleWikiLinks(view)
				let selection = view.state.selection.main
				let tree = syntaxTree(view.state)

				for (let link of links) {
					// Don't decorate if cursor is inside the wikilink
					if (selection.from >= link.from && selection.to <= link.to) {
						continue
					}

					// Don't decorate if inside inline code or code block
					let node = tree.resolveInner(link.from, 1)
					let inCode = false
					let current: typeof node | null = node
					while (current) {
						if (
							current.name === "InlineCode" ||
							current.name === "CodeBlock" ||
							current.name === "FencedCode"
						) {
							inCode = true
							break
						}
						current = current.parent
					}
					if (inCode) continue

					// Always call resolver - it uses refs so returns fresh data
					let resolved = this.resolver(link.id)
					let exists = resolved?.exists ?? false
					// Use alias if provided, otherwise fall back to resolved title
					let title = link.alias ?? resolved?.title ?? "Document Not Found"

					let widget = Decoration.replace({
						widget: new WikilinkWidget(link.id, title, exists, this.onNavigate),
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
		".cm-wikilink": {
			cursor: "pointer",
			textDecoration: "underline",
			textDecorationColor: "var(--muted-foreground)",
			display: "inline-flex",
			alignItems: "center",
			gap: "2px",
			verticalAlign: "baseline",
		},
		".cm-wikilink:hover": {
			textDecorationColor: "currentColor",
		},
		".cm-wikilink-icon": {
			flexShrink: "0",
			verticalAlign: "middle",
			opacity: "0.5",
		},
		".cm-wikilink-broken": {
			textDecoration: "underline wavy",
			textDecorationColor: "var(--destructive)",
		},
	})

	return [decorationPlugin, theme]
}

function parseVisibleWikiLinks(view: EditorView) {
	let links: WikiLink[] = []
	let previousTo = -1
	for (let range of view.visibleRanges) {
		let from = view.state.doc.lineAt(range.from).from
		let to = view.state.doc.lineAt(range.to).to
		if (from < previousTo) from = previousTo
		if (from >= to) continue
		let visibleText = view.state.sliceDoc(from, to)
		for (let link of parseWikiLinks(visibleText)) {
			links.push({
				...link,
				from: link.from + from,
				to: link.to + from,
			})
		}
		previousTo = to
	}
	return links
}
