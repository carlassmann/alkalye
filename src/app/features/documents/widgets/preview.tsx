import { useEffect, useState, useRef, useId, type RefObject } from "react"
import { createPortal } from "react-dom"
import { Image as JazzImage } from "jazz-tools/react"
import { getDocumentTitle } from "../lib/title"
import {
	isShortcutEvent,
	isShortcutTargetBlocked,
} from "@/app/lib/shortcut-registry"
import { exitFocusMode } from "@/app/lib/focus-mode"
import { Marked } from "marked"
import markedShiki from "marked-shiki"
import { createHighlighter, type Highlighter } from "shiki"
import {
	createWikilinkExtension,
	type WikilinkTitleResolver,
} from "@/app/features/import-export"
import { parseFrontmatter } from "@/app/features/editor"
import { type ResolvedDoc } from "../lib/wikilink-titles"
import { useResolvedTheme } from "@/app/components/appearance"
import {
	useDocumentTheme,
	getDefaultDocumentCss,
	sanitizeHtml,
	scopeThemeCss,
	tryCachedThemeStylesAsync,
	type ResolvedTheme,
	type ThemeStyles,
} from "@/app/features/themes"
import { TriangleAlert } from "lucide-react"
import {
	countOccurrences,
	findBestTextOccurrence,
} from "../lib/comment-text-match"

export { Preview }

type Asset = {
	$jazz: { id: string }
	$isLoaded?: boolean
	type?: "image" | "video" | "tldraw"
	image?: { $jazz: { id: string } }
	video?: { $isLoaded?: boolean; toBlob?: () => Blob | undefined }
	muteAudio?: boolean
	revision?: {
		$isLoaded?: boolean
		lightPreview?: { $jazz: { id: string } }
		darkPreview?: { $jazz: { id: string } }
	}
}

interface PreviewProps {
	content: string
	assets?: Asset[]
	wikilinks: Map<string, ResolvedDoc>
	onExit?: () => void
	comments?: PreviewComment[]
	onCommentSelect?: (threadId: string) => void
	onTextSelectionChange?: (selection: PreviewTextSelection | null) => void
	themeOverrideId?: string
	appearanceOverride?: "light" | "dark"
	embedded?: boolean
}

type PreviewComment = {
	id: string
	quote: string
	contextBefore: string
	contextAfter: string
	occurrence: number
	renderedFrom: number | null
	renderedTo: number | null
	resolved: boolean
	selected: boolean
}

type PreviewTextSelection = {
	text: string
	occurrence: number
	renderedFrom: number
	renderedTo: number
	contextBefore: string
	contextAfter: string
}

function Preview({
	content,
	assets,
	wikilinks,
	onExit,
	comments = [],
	onCommentSelect,
	onTextSelectionChange,
	themeOverrideId,
	appearanceOverride,
	embedded = false,
}: PreviewProps) {
	let resolvedTheme = useResolvedTheme()
	let previewAppearance = appearanceOverride ?? resolvedTheme
	let documentTheme = useDocumentTheme(
		content,
		"preview",
		previewAppearance,
		themeOverrideId,
	)

	let wikilinkResolver: WikilinkTitleResolver = docId => {
		return wikilinks.get(docId) ?? { title: docId, exists: false }
	}

	let marked = useMarked(wikilinkResolver, previewAppearance)

	if (!marked) return null

	return (
		<PreviewContent
			content={content}
			assets={assets}
			marked={marked}
			colorScheme={previewAppearance}
			cacheVersion={wikilinks.size}
			onExit={onExit}
			documentTheme={documentTheme}
			comments={comments}
			onCommentSelect={onCommentSelect}
			onTextSelectionChange={onTextSelectionChange}
			embedded={embedded}
		/>
	)
}

type Segment =
	| { type: "text"; html: string }
	| { type: "image"; imageId: string; alt: string }
	| { type: "video"; asset: Asset; alt: string }

function PreviewContent({
	content,
	assets,
	marked,
	colorScheme,
	cacheVersion,
	onExit,
	documentTheme,
	comments,
	onCommentSelect,
	onTextSelectionChange,
	embedded,
}: {
	content: string
	assets?: Asset[]
	marked: Marked
	colorScheme: "light" | "dark"
	cacheVersion: number
	onExit?: () => void
	documentTheme: ResolvedTheme
	comments: PreviewComment[]
	onCommentSelect?: (threadId: string) => void
	onTextSelectionChange?: (selection: PreviewTextSelection | null) => void
	embedded: boolean
}) {
	let [segments, setSegments] = useState<Segment[]>([])
	let [prevContent, setPrevContent] = useState(content)
	let previewRef = useRef<HTMLDivElement>(null)
	let themeScopeId = useId()
	let themeStylesResult = useThemeStyles(documentTheme)
	let themeStyles = themeStylesResult.styles

	// Reset segments when content becomes empty (adjust state during render pattern)
	if (content !== prevContent) {
		setPrevContent(content)
		if (!content) {
			setSegments([])
		}
	}

	useEffect(() => {
		if (!content) return

		let { body } = parseFrontmatter(content)
		let cancelled = false

		void parseSegments(body, assets, marked, colorScheme)
			.then(result => {
				if (!cancelled) setSegments(result)
			})
			.catch(() => undefined)

		return () => {
			cancelled = true
		}
	}, [content, assets, marked, cacheVersion, colorScheme])

	useEffect(() => {
		document.title = getDocumentTitle(content)
	}, [content])

	useEffect(() => {
		let exit = onExit
		if (!exit) return

		function handleKeyDown(e: KeyboardEvent) {
			if (e.defaultPrevented || isShortcutTargetBlocked(e.target)) return
			if (e.key === "Escape" && exitFocusMode()) return
			if (!isShortcutEvent(e, "preview")) return
			e.preventDefault()
			exit?.()
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [onExit])

	// Base transition styles to prevent layout shift when theme loads
	// These provide smooth transitions for common properties theme CSS might change
	let transitionStyles = documentTheme.theme
		? `[data-theme] { transition: color 150ms ease-out, background-color 150ms ease-out; }`
		: ""

	let documentBaseCss = scopeThemeCss(
		getDefaultDocumentCss(),
		`[data-theme-scope="${themeScopeId}"]`,
	)
	let themeRules = themeStyles
		? [transitionStyles, themeStyles.presetVariables, themeStyles.css]
				.filter(Boolean)
				.join("\n")
		: transitionStyles
	let isSourceTheme = Boolean(documentTheme.theme?.sourceDocId)
	let scopedThemeRules = isSourceTheme
		? scopeThemeCss(themeRules, `[data-theme-scope="${themeScopeId}"]`)
		: themeRules
	let injectedStyles = themeStyles
		? [documentBaseCss, scopedThemeRules, themeStyles.fontFaceRules]
				.filter(Boolean)
				.join("\n")
		: [documentBaseCss, scopedThemeRules].filter(Boolean).join("\n")

	let templateHtml = documentTheme.theme?.template?.toString() ?? null
	let templateError: string | null = null
	let safeTemplateHtml = templateHtml
		? sanitizeHtml(templateHtml).sanitized
		: null
	if (templateHtml) {
		let templateDocument = new DOMParser().parseFromString(
			templateHtml,
			"text/html",
		)
		if (templateDocument.querySelector("style")) {
			templateError =
				"HTML templates cannot contain style blocks; put CSS in a css theme fence"
		}
		let sanitizedDocument = safeTemplateHtml
			? new DOMParser().parseFromString(safeTemplateHtml, "text/html")
			: null
		let slots = sanitizedDocument?.querySelectorAll(
			"[data-content], [data-document]",
		)
		if (!slots?.length) {
			templateError = "Template is missing [data-content] placeholder"
		} else if (slots.length > 1) {
			templateError = "Template needs exactly one data-content placeholder"
		}
	}

	let errorMessage = themeStylesResult.error || templateError || null

	useEffect(() => {
		let root = previewRef.current
		if (!root) return
		applyPreviewCommentHighlights(root, comments, onCommentSelect)
		scrollSelectedPreviewCommentIntoView(root, comments)
	}, [segments, safeTemplateHtml, comments, onCommentSelect])

	useEffect(() => {
		function handleSelectionChange() {
			let root = previewRef.current
			let selection = document.getSelection()
			if (!root || !selection || selection.isCollapsed) {
				onTextSelectionChange?.(null)
				return
			}

			let anchorNode = selection.anchorNode
			let focusNode = selection.focusNode
			if (
				!anchorNode ||
				!focusNode ||
				!root.contains(anchorNode) ||
				!root.contains(focusNode)
			) {
				onTextSelectionChange?.(null)
				return
			}

			let selectedText = selection.toString()
			let leadingTrim = selectedText.length - selectedText.trimStart().length
			let trailingTrim = selectedText.length - selectedText.trimEnd().length
			let text = selectedText.trim()
			let startOffset = getSelectionTextOffset(root, selection)
			let renderedFrom = startOffset + leadingTrim
			let renderedTo = startOffset + selectedText.length - trailingTrim
			let rootText = getRootText(root)
			onTextSelectionChange?.(
				text
					? {
							text,
							occurrence: countOccurrences(
								rootText.slice(0, renderedFrom),
								text,
							),
							renderedFrom,
							renderedTo,
							contextBefore: rootText.slice(
								Math.max(0, renderedFrom - 80),
								renderedFrom,
							),
							contextAfter: rootText.slice(renderedTo, renderedTo + 80),
						}
					: null,
			)
		}

		document.addEventListener("selectionchange", handleSelectionChange)
		return () =>
			document.removeEventListener("selectionchange", handleSelectionChange)
	}, [onTextSelectionChange])

	return (
		<div
			className={
				embedded
					? "h-full min-h-0 min-w-0 flex-1 overflow-auto"
					: "min-w-0 flex-1 overflow-auto"
			}
			style={{
				paddingLeft: "env(safe-area-inset-left)",
				paddingRight: "env(safe-area-inset-right)",
				paddingBottom: "env(safe-area-inset-bottom)",
			}}
		>
			{/* Inject theme styles */}
			{injectedStyles && <style>{injectedStyles}</style>}

			{/* Theme warning banner */}
			{documentTheme.warning && (
				<div className="bg-warning/10 text-warning-foreground border-warning/20 mx-auto mt-4 flex max-w-[65ch] items-center gap-2 rounded-lg border px-4 py-2 text-sm">
					<TriangleAlert className="size-4 shrink-0" />
					<span>{documentTheme.warning}</span>
				</div>
			)}

			{/* Theme error banner (corrupted theme data) */}
			{errorMessage && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 mx-auto mt-4 flex max-w-[65ch] items-center gap-2 rounded-lg border px-4 py-2 text-sm">
					<TriangleAlert className="size-4 shrink-0" />
					<span>Theme error: {errorMessage}. Using default styles.</span>
				</div>
			)}

			<div
				data-theme-scope={themeScopeId}
				data-appearance={colorScheme}
				className="min-h-full"
			>
				{safeTemplateHtml && !templateError ? (
					<TemplatePreview
						previewRef={previewRef}
						templateHtml={safeTemplateHtml}
						segments={segments}
						themeName={documentTheme.theme?.name}
						appearance={colorScheme}
						embedded={embedded}
						comments={comments}
						onCommentSelect={onCommentSelect}
					/>
				) : (
					<div
						ref={previewRef}
						className={
							embedded ? "theme document min-h-full" : "theme document"
						}
						data-theme={documentTheme.theme?.name ?? undefined}
						data-appearance={colorScheme}
					>
						<PreviewSegments segments={segments} />
					</div>
				)}
			</div>
		</div>
	)
}

function applyPreviewCommentHighlights(
	root: HTMLElement,
	comments: PreviewComment[],
	onCommentSelect: ((threadId: string) => void) | undefined,
) {
	clearPreviewCommentHighlights(root)

	for (let comment of comments) {
		let quote = comment.quote.trim()
		if (!quote) continue
		let segments =
			comment.renderedFrom !== null && comment.renderedTo !== null
				? findTextSegmentsInRange(
						root,
						comment.renderedFrom,
						comment.renderedTo,
					)
				: findTextSegments(root, comment)
		for (let segment of segments) {
			wrapTextSegment(segment, () =>
				createCommentMark(comment, onCommentSelect),
			)
		}
	}
}

function TemplatePreview({
	previewRef,
	templateHtml,
	segments,
	themeName,
	appearance,
	embedded,
	comments,
	onCommentSelect,
}: {
	previewRef: RefObject<HTMLDivElement | null>
	templateHtml: string
	segments: Segment[]
	themeName?: string
	appearance: "light" | "dark"
	embedded: boolean
	comments: PreviewComment[]
	onCommentSelect?: (threadId: string) => void
}) {
	let [slot, setSlot] = useState<HTMLElement | null>(null)

	useEffect(() => {
		let root = previewRef.current
		if (!root || !slot) return
		applyPreviewCommentHighlights(root, comments, onCommentSelect)
		scrollSelectedPreviewCommentIntoView(root, comments)
	}, [previewRef, slot, segments, comments, onCommentSelect])

	return (
		<>
			<div
				ref={node => {
					previewRef.current = node
					let candidate = node?.querySelector("[data-content], [data-document]")
					setSlot(candidate instanceof HTMLElement ? candidate : null)
				}}
				className={embedded ? "theme document min-h-full" : "theme document"}
				data-theme={themeName}
				data-appearance={appearance}
				dangerouslySetInnerHTML={{ __html: templateHtml }}
			/>
			{slot && createPortal(<PreviewSegments segments={segments} />, slot)}
		</>
	)
}

function PreviewSegments({ segments }: { segments: Segment[] }) {
	return (
		<article className="content">
			{segments.map((segment, i) => {
				if (segment.type === "text") {
					return (
						<div key={i} dangerouslySetInnerHTML={{ __html: segment.html }} />
					)
				}
				if (segment.type === "image") {
					return (
						<figure key={i} className="my-4">
							<JazzImage
								imageId={segment.imageId}
								alt={segment.alt}
								className="w-full rounded-lg"
							/>
							{segment.alt && (
								<figcaption className="text-muted-foreground mt-2 text-center text-sm">
									{segment.alt}
								</figcaption>
							)}
						</figure>
					)
				}
				return (
					<figure key={i} className="my-4 flex flex-col items-center">
						<VideoPlayer asset={segment.asset} />
						{segment.alt && (
							<figcaption className="text-muted-foreground mt-2 text-center text-sm">
								{segment.alt}
							</figcaption>
						)}
					</figure>
				)
			})}
		</article>
	)
}

function clearPreviewCommentHighlights(root: HTMLElement) {
	for (let mark of root.querySelectorAll(".preview-comment-range")) {
		let parent = mark.parentNode
		if (!parent) continue
		while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
		parent.removeChild(mark)
		parent.normalize()
	}
}

function scrollSelectedPreviewCommentIntoView(
	root: HTMLElement,
	comments: PreviewComment[],
) {
	let selected = comments.find(comment => comment.selected)
	if (!selected) return
	for (let mark of root.querySelectorAll<HTMLElement>("[data-comment-id]")) {
		if (mark.dataset.commentId !== selected.id) continue
		mark.scrollIntoView({
			block: "center",
			inline: "nearest",
			behavior: "smooth",
		})
		return
	}
}

function getSelectionTextOffset(root: HTMLElement, selection: Selection) {
	let range = selection.getRangeAt(0)
	return getLogicalTextOffset(root, range.startContainer, range.startOffset)
}

function findTextSegments(root: HTMLElement, comment: PreviewComment) {
	let rootText = getRootText(root)
	let start = findCommentStart(rootText, comment)
	if (start < 0) return []
	let quote = comment.quote.trim()
	return findTextSegmentsInRange(root, start, start + quote.length)
}

function findTextSegmentsInRange(
	root: HTMLElement,
	start: number,
	end: number,
) {
	let walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	let segments: TextSegment[] = []
	let node = walker.nextNode()
	let seen = 0
	while (node) {
		if (!(node instanceof Text)) {
			node = walker.nextNode()
			continue
		}
		if (isGeneratedWhitespaceNode(node)) {
			node = walker.nextNode()
			continue
		}
		let text = node.textContent ?? ""
		let next = seen + text.length
		if (next > start && seen < end) {
			segments.push({
				node,
				start: Math.max(0, start - seen),
				end: Math.min(text.length, end - seen),
			})
		}
		seen = next
		node = walker.nextNode()
	}
	return segments.reverse()
}

function findCommentStart(content: string, comment: PreviewComment) {
	let quote = comment.quote.trim()
	return findBestTextOccurrence(content, quote, comment)
}

type TextSegment = {
	node: Text
	start: number
	end: number
}

function wrapTextSegment(segment: TextSegment, createMark: () => HTMLElement) {
	if (segment.start >= segment.end) return
	let selected = segment.node
	if (segment.end < selected.length) selected.splitText(segment.end)
	if (segment.start > 0) selected = selected.splitText(segment.start)
	let parent = selected.parentNode
	if (!parent) return
	let mark = createMark()
	parent.insertBefore(mark, selected)
	mark.appendChild(selected)
}

function createCommentMark(
	comment: PreviewComment,
	onCommentSelect?: (threadId: string) => void,
) {
	let mark = document.createElement("mark")
	mark.role = "button"
	mark.tabIndex = 0
	mark.dataset.commentId = comment.id
	mark.className = [
		"preview-comment-range",
		comment.resolved ? "preview-comment-range-resolved" : "",
		comment.selected ? "preview-comment-range-selected" : "",
	]
		.filter(Boolean)
		.join(" ")
	mark.addEventListener("click", event => {
		event.preventDefault()
		onCommentSelect?.(comment.id)
	})
	mark.addEventListener("keydown", event => {
		if (event.key !== "Enter" && event.key !== " ") return
		event.preventDefault()
		onCommentSelect?.(comment.id)
	})
	return mark
}

function getRootText(root: HTMLElement) {
	let walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	let text = ""
	let node = walker.nextNode()
	while (node) {
		if (node instanceof Text && !isGeneratedWhitespaceNode(node)) {
			text += node.textContent ?? ""
		}
		node = walker.nextNode()
	}
	return text
}

function getLogicalTextOffset(
	root: HTMLElement,
	target: Node,
	targetOffset: number,
) {
	let walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	let offset = 0
	let node = walker.nextNode()
	while (node) {
		if (!(node instanceof Text) || isGeneratedWhitespaceNode(node)) {
			node = walker.nextNode()
			continue
		}
		if (node === target) return offset + targetOffset
		offset += node.textContent?.length ?? 0
		node = walker.nextNode()
	}
	return offset
}

function isGeneratedWhitespaceNode(node: Text) {
	return !node.textContent?.trim() && !node.parentElement?.closest("pre, code")
}

type ThemeStylesResult = {
	styles: ThemeStyles | null
	error: string | null
	isLoading: boolean
}

// Hook to get theme styles using the global cache with async loading
// Styles are loaded asynchronously to prevent blocking rendering of large themes
// Cache handles blob URL lifecycle, so no cleanup needed here
function useThemeStyles(documentTheme: ResolvedTheme): ThemeStylesResult {
	let [styles, setStyles] = useState<ThemeStyles | null>(null)
	let [error, setError] = useState<string | null>(null)
	// Track the theme ID we've loaded styles for to derive loading state
	let [loadedThemeId, setLoadedThemeId] = useState<string | null>(null)

	let currentThemeId = documentTheme.theme?.$jazz.id ?? null
	let isLoading = currentThemeId !== null && currentThemeId !== loadedThemeId

	// Clear state when theme is removed (adjust state during render pattern)
	let [prevThemeId, setPrevThemeId] = useState<string | null>(currentThemeId)
	if (currentThemeId !== prevThemeId) {
		setPrevThemeId(currentThemeId)
		if (currentThemeId === null) {
			setStyles(null)
			setError(null)
			setLoadedThemeId(null)
		}
	}

	useEffect(() => {
		// Get styles from cache asynchronously (builds and caches if needed)
		if (!documentTheme.theme) return

		let cancelled = false
		let themeId = documentTheme.theme.$jazz.id

		tryCachedThemeStylesAsync(documentTheme.theme, documentTheme.preset).then(
			buildResult => {
				if (cancelled) return
				if (buildResult.ok) {
					setStyles(buildResult.styles)
					setError(null)
				} else {
					setStyles(null)
					setError(buildResult.error)
				}
				setLoadedThemeId(themeId)
			},
		)

		return () => {
			cancelled = true
		}
	}, [
		documentTheme.theme,
		documentTheme.preset,
		documentTheme.theme?.updatedAt,
	])

	return { styles, error, isLoading }
}

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ["github-light", "vesper"],
			langs: [
				"javascript",
				"typescript",
				"jsx",
				"tsx",
				"html",
				"css",
				"json",
				"markdown",
				"bash",
				"shell",
				"python",
				"rust",
				"go",
				"sql",
				"yaml",
				"toml",
			],
		})
	}
	return highlighterPromise
}

function useMarked(
	wikilinkResolver: WikilinkTitleResolver,
	resolvedTheme: "light" | "dark",
) {
	let [marked, setMarked] = useState<Marked | null>(null)
	let resolverRef = useRef(wikilinkResolver)
	useEffect(() => {
		resolverRef.current = wikilinkResolver
	})

	useEffect(() => {
		let cancelled = false
		getHighlighter().then(highlighter => {
			if (cancelled) return
			let instance = createMarkedInstance(highlighter, resolvedTheme, id =>
				resolverRef.current(id),
			)
			setMarked(instance)
		})
		return () => {
			cancelled = true
		}
	}, [resolvedTheme])

	return marked
}

function createMarkedInstance(
	highlighter: Highlighter,
	theme: "light" | "dark",
	wikilinkResolver: WikilinkTitleResolver,
) {
	let instance = new Marked()
	instance.use(
		markedShiki({
			highlight(code, lang) {
				return highlighter.codeToHtml(code, {
					lang: lang || "text",
					theme: theme === "dark" ? "vesper" : "github-light",
				})
			},
		}),
	)
	instance.use(createWikilinkExtension(wikilinkResolver))
	instance.use({
		renderer: {
			image({ href, title, text }) {
				let titleAttr = title ? ` title="${title}"` : ""
				let caption = text
					? `<figcaption class="text-muted-foreground mt-2 text-center text-sm">${text}</figcaption>`
					: ""
				return `<figure class="my-4"><img src="${href}" alt="${text || ""}"${titleAttr} class="w-full rounded-lg" />${caption}</figure>`
			},
		},
	})
	instance.setOptions({ gfm: true, breaks: true })
	return instance
}

type RawSegment =
	| { type: "text"; content: string }
	| { type: "image"; imageId: string; alt: string }
	| { type: "video"; asset: Asset; alt: string }

async function parseSegments(
	content: string,
	assets: Asset[] | undefined,
	marked: Marked,
	colorScheme: "light" | "dark",
): Promise<Segment[]> {
	let rawSegments: RawSegment[] = []
	let lastIndex = 0
	let regex = /!\[([^\]]*)\]\(asset:([^)]+)\)/g
	let match

	while ((match = regex.exec(content)) !== null) {
		if (match.index > lastIndex) {
			rawSegments.push({
				type: "text",
				content: content.slice(lastIndex, match.index),
			})
		}

		let alt = match[1]
		let assetId = match[2]
		let asset = assets?.find(a => a?.$jazz.id === assetId)

		if (asset?.$isLoaded && asset.type === "image" && asset.image) {
			rawSegments.push({
				type: "image",
				imageId: asset.image.$jazz.id,
				alt,
			})
		} else if (asset?.$isLoaded && asset.type === "tldraw") {
			let preview =
				colorScheme === "dark"
					? asset.revision?.darkPreview
					: asset.revision?.lightPreview
			if (preview) {
				rawSegments.push({
					type: "image",
					imageId: preview.$jazz.id,
					alt,
				})
			} else {
				rawSegments.push({ type: "text", content: match[0] })
			}
		} else if (asset?.$isLoaded && asset.type === "video" && asset.video) {
			rawSegments.push({
				type: "video",
				asset,
				alt,
			})
		} else {
			rawSegments.push({
				type: "text",
				content: match[0],
			})
		}

		lastIndex = match.index + match[0].length
	}

	if (lastIndex < content.length) {
		rawSegments.push({
			type: "text",
			content: content.slice(lastIndex),
		})
	}

	return Promise.all(
		rawSegments.map(async seg => {
			if (seg.type === "image") return seg
			if (seg.type === "video") return seg
			let html = await marked.parse(seg.content)
			return { type: "text" as const, html }
		}),
	)
}

function VideoPlayer({ asset }: { asset: Asset }) {
	let video = asset.video
	let url = useVideoUrl(video)

	if (!url) {
		return (
			<div className="bg-muted flex aspect-video w-full items-center justify-center rounded-lg">
				<span className="text-muted-foreground text-sm">Loading video...</span>
			</div>
		)
	}

	return (
		<video
			src={url}
			controls
			muted={asset.muteAudio}
			className="max-h-[70vh] w-auto max-w-full rounded-lg"
		/>
	)
}

function useVideoUrl(
	video: { $isLoaded?: boolean; toBlob?: () => Blob | undefined } | undefined,
): string | null {
	let [url, setUrl] = useState<string | null>(null)
	let [trackedVideo, setTrackedVideo] = useState(video)

	// Reset when video changes (adjust state during render)
	if (trackedVideo !== video) {
		setTrackedVideo(video)
		if (url) {
			URL.revokeObjectURL(url)
			setUrl(null)
		}
	}

	// Load URL - schedule via rAF to avoid lint error
	useEffect(() => {
		if (url) return
		if (!video?.$isLoaded || !video.toBlob) return

		let cancelled = false
		requestAnimationFrame(() => {
			if (cancelled) return
			let blob = video.toBlob?.()
			if (!blob) return
			let objectUrl = URL.createObjectURL(blob)
			setUrl(objectUrl)
		})

		return () => {
			cancelled = true
		}
	}, [video, url])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (url) URL.revokeObjectURL(url)
		}
	}, [url])

	return url
}
