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

export { createImageDecorations }
export type { ImageResolver }

type ResolvedAsset = { url: string; type: "image" | "video" | "tldraw" }
type ImageResolver = (assetId: string) => ResolvedAsset | undefined

function createImageDecorations(
	resolver: ImageResolver,
	onPreview: (url: string, alt: string) => void,
): Extension {
	let decorationPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet
			resolver: ImageResolver
			onPreview: (url: string, alt: string) => void

			constructor(view: EditorView) {
				this.resolver = resolver
				this.onPreview = onPreview
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
				let images = parseImages(view, this.resolver)
				let selection = view.state.selection.main

				for (let img of images) {
					// Don't decorate if cursor is inside the image syntax
					if (selection.from >= img.from && selection.to <= img.to) {
						continue
					}

					let widget = Decoration.replace({
						widget: new ImageWidget(
							img.alt,
							img.url,
							img.assetType,
							this.onPreview,
						),
					})
					builder.add(img.from, img.to, widget)
				}

				return builder.finish()
			}
		},
		{
			decorations: v => v.decorations,
		},
	)

	let theme = EditorView.baseTheme({
		".cm-md-image": {
			cursor: "pointer",
			textDecoration: "underline",
			textDecorationColor: "var(--muted-foreground)",
			display: "inline-flex",
			alignItems: "center",
			gap: "2px",
			verticalAlign: "baseline",
		},
		".cm-md-image:hover": {
			textDecorationColor: "currentColor",
		},
		".cm-md-image-icon": {
			flexShrink: "0",
			verticalAlign: "middle",
			opacity: "0.5",
		},
	})

	return [decorationPlugin, theme]
}

// Helpers

class ImageWidget extends WidgetType {
	text: string
	url: string
	assetType: "image" | "video" | "tldraw"
	onPreview: (url: string, alt: string) => void

	constructor(
		text: string,
		url: string,
		assetType: "image" | "video" | "tldraw",
		onPreview: (url: string, alt: string) => void,
	) {
		super()
		this.text = text
		this.url = url
		this.assetType = assetType
		this.onPreview = onPreview
	}

	toDOM() {
		let span = document.createElement("span")
		span.className = "cm-md-image"

		let icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
		icon.setAttribute("width", "14")
		icon.setAttribute("height", "14")
		icon.setAttribute("viewBox", "0 0 24 24")
		icon.setAttribute("fill", "none")
		icon.setAttribute("stroke", "currentColor")
		icon.setAttribute("stroke-width", "2")
		icon.setAttribute("stroke-linecap", "round")
		icon.setAttribute("stroke-linejoin", "round")
		icon.classList.add("cm-md-image-icon")

		if (this.assetType === "video") {
			// Film icon from lucide
			icon.innerHTML = `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>`
		} else if (this.assetType === "tldraw") {
			icon.innerHTML = `<path d="M12 19h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`
		} else {
			// Image icon from lucide
			icon.innerHTML = `<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`
		}

		span.appendChild(icon)
		span.appendChild(document.createTextNode(this.text))

		span.addEventListener("mousedown", e => {
			e.preventDefault()
			e.stopPropagation()
		})

		span.addEventListener("click", e => {
			e.preventDefault()
			e.stopPropagation()
			this.onPreview(this.url, this.text)
		})

		return span
	}

	eq(other: ImageWidget) {
		return (
			this.text === other.text &&
			this.url === other.url &&
			this.assetType === other.assetType
		)
	}

	ignoreEvent(e: Event) {
		return e.type === "mousedown" || e.type === "click"
	}
}

interface ImageMatch {
	from: number
	to: number
	alt: string
	url: string
	assetType: "image" | "video" | "tldraw"
}

function parseImages(view: EditorView, resolver: ImageResolver): ImageMatch[] {
	let images: ImageMatch[] = []
	let tree = syntaxTree(view.state)

	for (let visibleRange of view.visibleRanges) {
		tree.iterate({
			from: visibleRange.from,
			to: visibleRange.to,
			enter: node => {
				if (node.name !== "Image") return
				let urlNode = node.node.getChild("URL")
				if (!urlNode) return

				let rawUrl = view.state.sliceDoc(urlNode.from, urlNode.to)

				// Extract alt text between ![ and ]
				// Format: ![alt](url) - alt is between ![ and ]
				let imageContent = view.state.sliceDoc(node.from, node.to)
				let match = imageContent.match(/^!\[([^\]]*)\]/)
				let alt = match?.[1] || "Media"

				// Resolve asset: URLs
				let url = rawUrl
				let assetType: "image" | "video" | "tldraw" = "image"
				if (rawUrl.startsWith("asset:")) {
					let assetId = rawUrl.slice(6)
					let resolved = resolver(assetId)
					if (resolved) {
						url = resolved.url
						assetType = resolved.type
					}
				}

				images.push({
					from: node.from,
					to: node.to,
					alt,
					url,
					assetType,
				})
			},
		})
	}

	return images
}
