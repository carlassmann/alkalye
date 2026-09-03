import { type Extension, RangeSetBuilder } from "@codemirror/state"
import {
	EditorView,
	Decoration,
	type DecorationSet,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view"
import { getFrontmatterRange, getBacklinksWithRange } from "./frontmatter"

export { createBacklinkDecorations }
export type { BacklinkResolver }

type BacklinkResolver = (
	id: string,
) => { title: string; exists: boolean } | undefined

class BacklinkWidget extends WidgetType {
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
			? "cm-backlink"
			: "cm-backlink cm-backlink-broken"

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
		icon.classList.add("cm-backlink-icon")

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
			e.preventDefault()
			e.stopPropagation()
		})

		span.addEventListener("click", e => {
			e.preventDefault()
			e.stopPropagation()
			if (this.exists) {
				this.onNavigate(this.id, e.ctrlKey || e.metaKey)
			}
		})

		return span
	}

	eq(other: BacklinkWidget) {
		return (
			this.id === other.id &&
			this.title === other.title &&
			this.exists === other.exists
		)
	}

	ignoreEvent(e: Event) {
		return e.type === "mousedown" || e.type === "click"
	}
}

function createBacklinkDecorations(
	resolver: BacklinkResolver,
	onNavigate: (id: string, newTab: boolean) => void,
): Extension {
	let decorationPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet
			resolver: BacklinkResolver
			onNavigate: (id: string, newTab: boolean) => void

			constructor(view: EditorView) {
				this.resolver = resolver
				this.onNavigate = onNavigate
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
				let doc = view.state.doc

				// Check if frontmatter exists
				let fmRange = getFrontmatterRange(view.state)
				if (!fmRange) return Decoration.none
				let text = doc.sliceString(0, fmRange.to)

				let backlinks = getBacklinksWithRange(text)
				if (!backlinks || backlinks.ids.length === 0) return Decoration.none

				let selection = view.state.selection.main

				// Don't decorate if cursor is on the backlinks line
				if (
					selection.from >= backlinks.lineFrom &&
					selection.to <= backlinks.lineTo
				) {
					return Decoration.none
				}

				// Create widgets for each ID
				let widgets: { from: number; to: number; widget: BacklinkWidget }[] = []
				let currentPos = backlinks.valueFrom
				let idsText = text.slice(backlinks.valueFrom, backlinks.valueTo)
				let parts = idsText.split(",")

				for (let i = 0; i < parts.length; i++) {
					let part = parts[i]
					let trimmedId = part.trim()
					if (!trimmedId) {
						currentPos += part.length + 1
						continue
					}

					let resolved = this.resolver(trimmedId)
					let title = resolved?.title ?? trimmedId
					let exists = resolved?.exists ?? false

					let leadingSpaces = part.length - part.trimStart().length
					let idStart = currentPos + leadingSpaces
					let idEnd = idStart + trimmedId.length

					widgets.push({
						from: idStart,
						to: idEnd,
						widget: new BacklinkWidget(
							trimmedId,
							title,
							exists,
							this.onNavigate,
						),
					})

					currentPos += part.length + 1
				}

				for (let w of widgets) {
					let deco = Decoration.replace({
						widget: w.widget,
					})
					builder.add(w.from, w.to, deco)
				}

				return builder.finish()
			}
		},
		{
			decorations: v => v.decorations,
		},
	)

	let theme = EditorView.baseTheme({
		".cm-backlink": {
			cursor: "pointer",
			textDecoration: "underline",
			textDecorationColor: "var(--muted-foreground)",
			display: "inline-flex",
			alignItems: "center",
			gap: "2px",
			verticalAlign: "baseline",
		},
		".cm-backlink:hover": {
			textDecorationColor: "currentColor",
		},
		".cm-backlink-icon": {
			flexShrink: "0",
			verticalAlign: "middle",
			opacity: "0.5",
		},
		".cm-backlink-broken": {
			textDecoration: "underline wavy",
			textDecorationColor: "var(--destructive)",
		},
	})

	return [decorationPlugin, theme]
}
