import {
	useEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type MutableRefObject,
	type PointerEvent,
	type RefObject,
} from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { co, type ResolveQuery } from "jazz-tools"
import { useAccount, useCoState } from "jazz-tools/react"
import {
	AlertCircle,
	ArrowLeft,
	ExternalLink,
	FileText,
	Maximize2,
	Minimize2,
	Moon,
	MonitorPlay,
	PanelLeftOpen,
	PanelRightOpen,
	Sun,
} from "lucide-react"
import { Button } from "@/app/components/ui/button"
import { SidebarProvider } from "@/app/components/ui/sidebar"
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@/app/components/ui/empty"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select"
import {
	Preview,
	persistDocumentContentSynchronously,
	useDocTitles,
	type ResolvedDoc,
} from "@/app/features/documents"
import {
	MarkdownEditor,
	parseWikiLinks,
	useEditorSettings,
	useMarkdownEditorRef,
	type MarkdownEditorRef,
} from "@/app/features/editor"
import { assetPreviewResolve } from "@/app/features/assets"
import {
	parsePresentation,
	Slideshow,
	type PresentationItem,
	type Slide,
} from "@/app/features/presentation"
import { Document, UserAccount } from "@/schema"
import {
	getThemeSourceId,
	parseThemeSource,
	createDefaultTheme,
	syncThemeFromSource,
	Theme,
} from "@/app/features/themes"

import { bindThemeSource } from "../lib/source"

export { ThemeWorkbenchScreen }

let themeResolve = {
	css: true,
	template: true,
	slideTemplate: true,
} as const satisfies ResolveQuery<typeof Theme>

let sourceResolve = { content: true } as const satisfies ResolveQuery<
	typeof Document
>

let documentsResolve = {
	root: {
		settings: true,
		documents: {
			$each: { content: true, assets: { $each: assetPreviewResolve } },
		},
	},
} as const satisfies ResolveQuery<typeof UserAccount>

let sampleContent = `# Theme workbench

Use this sample to tune type, color, spacing, and templates.

## Type scale

- First item
- Second item with **strong** and *emphasized* text

| Name | Value |
| --- | --- |
| Accent | #7157d9 |
| Radius | 8px |

~~~css
[data-theme] h1 { letter-spacing: -0.04em; }
~~~

> Select a document above to test its content without changing that document's theme.
`

type PreviewTarget = "sample" | string
type PreviewMode = "document" | "slideshow"
type WorkbenchLayout = "split" | "source" | "preview"

let presentationSampleContent = `---
mode: presentation
---

# Theme workbench

Design the opening moment.

---

## A second slide

- hierarchy
- spacing
- contrast
`

function ThemeWorkbenchScreen({ id }: { id: string }) {
	let account = useAccount(UserAccount, { resolve: documentsResolve })
	let theme = useCoState(Theme, id, { resolve: themeResolve })
	let sourceId = theme.$isLoaded ? theme.sourceDocId : undefined
	let source = useCoState(Document, sourceId, { resolve: sourceResolve })

	if (!theme.$isLoaded && theme.$jazz.loadingState !== "loading") {
		return <ThemeUnavailable />
	}

	if (!theme.$isLoaded || !account.$isLoaded) {
		return <LoadingWorkbench />
	}

	if (!sourceId || !source.$isLoaded || !source.content?.$isLoaded) {
		return <MissingSource themeName={theme.name} />
	}

	return <Workbench theme={theme} source={source} account={account} />
}

function LoadingWorkbench() {
	return (
		<Empty className="h-screen">
			<EmptyHeader>
				<EmptyTitle>Loading theme…</EmptyTitle>
			</EmptyHeader>
		</Empty>
	)
}

function ThemeUnavailable() {
	return (
		<Empty className="h-screen">
			<EmptyHeader>
				<EmptyTitle>Theme unavailable</EmptyTitle>
				<EmptyDescription>
					This theme is unavailable or you no longer have access to it.
				</EmptyDescription>
			</EmptyHeader>
			<Link to="/settings" search={{ from: undefined }}>
				<Button variant="outline" size="sm">
					Back to settings
				</Button>
			</Link>
		</Empty>
	)
}

function MissingSource({ themeName }: { themeName: string }) {
	return (
		<Empty className="h-screen">
			<EmptyHeader>
				<EmptyTitle>Theme source unavailable</EmptyTitle>
				<EmptyDescription>
					{themeName} does not have an editable source document.
				</EmptyDescription>
			</EmptyHeader>
			<Link to="/settings" search={{ from: undefined }}>
				<Button variant="outline" size="sm">
					Back to settings
				</Button>
			</Link>
		</Empty>
	)
}

type LoadedTheme = co.loaded<typeof Theme, typeof themeResolve>
type LoadedSource = co.loaded<typeof Document, typeof sourceResolve>
type LoadedAccount = co.loaded<typeof UserAccount, typeof documentsResolve>

function Workbench({
	theme,
	source,
	account,
}: {
	theme: LoadedTheme
	source: LoadedSource
	account: LoadedAccount
}) {
	let editor = useMarkdownEditorRef()
	let sourceContent = source.content.toString()
	let parsed = parseThemeSource(sourceContent)
	let [target, setTarget] = useState<PreviewTarget>("sample")
	let [mode, setMode] = useState<PreviewMode>("document")
	let [appearance, setAppearance] = useState<"light" | "dark">("light")
	let [isCreatingDefault, setIsCreatingDefault] = useState(false)
	let [slideNumber, setSlideNumber] = useState(1)
	let [sourceSyncError, setSourceSyncError] = useState<string | null>(null)
	let [layout, setLayout] = useState<WorkbenchLayout>("split")
	let [split, setSplit] = useState(50)
	let layoutRef = useRef<HTMLDivElement>(null)
	let isResizing = useRef(false)
	let isDesktop = useWorkbenchDesktop()
	let sourceSyncState = useRef({ content: sourceContent, sequence: 0 })
	if (sourceSyncState.current.content !== sourceContent) {
		sourceSyncState.current = {
			content: sourceContent,
			sequence: sourceSyncState.current.sequence + 1,
		}
	}
	let navigate = useNavigate()
	let documents = getTargetDocuments(account, source.$jazz.id)
	let targetDocument = documents.find(document => document.$jazz.id === target)
	let targetContent =
		targetDocument?.content.toString() ??
		(mode === "slideshow" ? presentationSampleContent : sampleContent)
	let previewContent = targetContent
	let editorSettings = account.root?.settings?.$isLoaded
		? account.root.settings
		: undefined
	let { settings } = useEditorSettings(editorSettings)
	let wikilinkIds = parseWikiLinks(targetContent).map(link => link.id)
	let wikilinks = useDocTitles(wikilinkIds, new Map<string, ResolvedDoc>())
	let assets = targetDocument?.assets?.$isLoaded
		? targetDocument.assets.filter(asset => asset?.$isLoaded)
		: []
	let slides = getSlides(parsePresentation(targetContent))
	let currentSlideNumber = slides.some(
		slide => slide.slideNumber === slideNumber,
	)
		? slideNumber
		: (slides[0]?.slideNumber ?? 1)

	async function handleCreateDefaultTheme() {
		setIsCreatingDefault(true)
		try {
			let defaultTheme = await createDefaultTheme(account)
			navigate({
				to: "/themes/$id/workbench",
				params: { id: defaultTheme.$jazz.id },
			})
		} finally {
			setIsCreatingDefault(false)
		}
	}

	return (
		<SidebarProvider>
			<div className="bg-background fixed inset-0 flex flex-col">
				<header className="border-border flex h-12 shrink-0 items-center gap-2 border-b px-3">
					<Link to="/settings" search={{ from: undefined }}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Back to settings"
						>
							<ArrowLeft className="size-4" />
						</Button>
					</Link>
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium">{theme.name}</div>
						<div className="text-muted-foreground text-xs">Theme workbench</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						disabled={isCreatingDefault}
						onClick={() => void handleCreateDefaultTheme()}
					>
						New from default
					</Button>
					<Link to="/doc/$id" params={{ id: source.$jazz.id }}>
						<Button variant="outline" size="sm">
							<ExternalLink className="size-3.5" />
							Open source
						</Button>
					</Link>
				</header>
				<div
					ref={layoutRef}
					className="flex min-h-0 flex-1 flex-col lg:flex-row"
				>
					<section
						className={
							layout === "preview"
								? "hidden"
								: "border-border flex min-h-0 min-w-0 flex-col border-b lg:border-r lg:border-b-0"
						}
						style={getPaneStyle("source", layout, split)}
					>
						<div className="border-border flex shrink-0 items-center justify-between border-b px-3 py-2">
							<div className="flex items-center gap-2 text-xs font-medium">
								<FileText className="text-muted-foreground size-3.5" />
								Source
							</div>
							<div className="flex min-w-0 items-center gap-1">
								<div className="text-muted-foreground min-w-0 truncate text-xs">
									Saved locally
								</div>
								<PaneLayoutControls
									pane="source"
									layout={layout}
									setLayout={setLayout}
								/>
							</div>
						</div>
						<div className="markdown-editor theme-workbench-editor min-h-0 flex-1">
							<MarkdownEditor
								ref={editor}
								value={sourceContent}
								onChange={makeSourceChange(
									theme.$jazz.id,
									source,
									account,
									setSourceSyncError,
									sourceSyncState,
								)}
								placeholder="Write theme source"
								spellcheck={settings.spellcheck}
								spellcheckLanguage={settings.spellcheckLanguage}
								smartPairs={settings.smartPairs}
								markerWrapping={settings.markerWrapping}
								tabIndent={settings.tabIndent}
								smartPaste={settings.smartPaste}
								autocomplete={settings.autocomplete}
								documents={documents.map(document => ({
									id: document.$jazz.id,
									title: document.title || "Untitled document",
								}))}
							/>
						</div>
						<SourceErrors
							errors={parsed.errors}
							source={sourceContent}
							editor={editor}
						/>
						<SourceSyncError error={sourceSyncError} />
					</section>
					{layout === "split" && (
						<WorkbenchSeparator
							isDesktop={isDesktop}
							split={split}
							setSplit={setSplit}
							layoutRef={layoutRef}
							isResizing={isResizing}
						/>
					)}
					{layout === "preview" && (
						<RestorePaneBar pane="source" setLayout={setLayout} />
					)}
					<section
						className={
							layout === "source" ? "hidden" : "flex min-h-0 min-w-0 flex-col"
						}
						style={getPaneStyle("preview", layout, split)}
					>
						<div className="border-border flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2 sm:gap-2">
							<MonitorPlay className="text-muted-foreground size-3.5" />
							<div className="hidden text-xs font-medium sm:block">
								Live preview
							</div>
							<div className="ml-auto flex items-center gap-1">
								<PreviewModeControl mode={mode} setMode={setMode} />
								<AppearanceControl
									appearance={appearance}
									setAppearance={setAppearance}
								/>
								<PaneLayoutControls
									pane="preview"
									layout={layout}
									setLayout={setLayout}
								/>
							</div>
							<div className="w-36 sm:w-48">
								<Select
									value={target}
									onValueChange={makeTargetChange(setTarget, setSlideNumber)}
								>
									<SelectTrigger
										size="sm"
										aria-label="Preview target"
										className="w-full"
									>
										<SelectValue>
											{getTargetLabel(target, targetDocument)}
										</SelectValue>
									</SelectTrigger>
									<SelectContent align="end">
										<SelectItem value="sample">Sample content</SelectItem>
										{documents.map(document => (
											<SelectItem
												key={document.$jazz.id}
												value={document.$jazz.id}
											>
												{document.title || "Untitled document"}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="min-h-0 flex-1">
							{mode === "slideshow" ? (
								<Slideshow
									content={previewContent}
									slides={slides}
									assets={assets}
									wikilinks={wikilinks}
									currentSlideNumber={currentSlideNumber}
									highlightRange={null}
									onSlideChange={setSlideNumber}
									embedded
									themeOverrideId={theme.$jazz.id}
									appearanceOverride={appearance}
								/>
							) : (
								<Preview
									content={previewContent}
									assets={assets}
									wikilinks={wikilinks}
									themeOverrideId={theme.$jazz.id}
									appearanceOverride={appearance}
									embedded
								/>
							)}
						</div>
					</section>
					{layout === "source" && (
						<RestorePaneBar pane="preview" setLayout={setLayout} />
					)}
				</div>
			</div>
		</SidebarProvider>
	)
}

function getTargetLabel(
	target: PreviewTarget,
	document: ReturnType<typeof getTargetDocuments>[number] | undefined,
) {
	if (target === "sample") return "Sample content"
	return document?.title || "Untitled document"
}

function useWorkbenchDesktop() {
	let [isDesktop, setIsDesktop] = useState(false)

	useEffect(() => {
		let query = window.matchMedia("(min-width: 1024px)")
		function updateDesktop() {
			setIsDesktop(query.matches)
		}
		updateDesktop()
		query.addEventListener("change", updateDesktop)
		return () => query.removeEventListener("change", updateDesktop)
	}, [])

	return isDesktop
}

function getPaneStyle(
	pane: "source" | "preview",
	layout: WorkbenchLayout,
	split: number,
) {
	let flexGrow =
		layout === "split" ? (pane === "source" ? split : 100 - split) : 1
	return { flexGrow, flexBasis: 0 }
}

function PaneLayoutControls({
	pane,
	layout,
	setLayout,
}: {
	pane: "source" | "preview"
	layout: WorkbenchLayout
	setLayout: (layout: WorkbenchLayout) => void
}) {
	if (layout === pane) {
		return (
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={() => setLayout("split")}
				aria-label="Restore split view"
				title="Restore split view"
			>
				<Minimize2 className="size-3.5" />
			</Button>
		)
	}

	let otherPane: WorkbenchLayout = pane === "source" ? "preview" : "source"
	return (
		<div className="flex items-center">
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={() => setLayout(otherPane)}
				aria-label={`Minimize ${pane}`}
				title={`Minimize ${pane}`}
			>
				<Minimize2 className="size-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={() => setLayout(pane)}
				aria-label={`Maximize ${pane}`}
				title={`Maximize ${pane}`}
			>
				<Maximize2 className="size-3.5" />
			</Button>
		</div>
	)
}

function RestorePaneBar({
	pane,
	setLayout,
}: {
	pane: "source" | "preview"
	setLayout: (layout: WorkbenchLayout) => void
}) {
	let Icon = pane === "source" ? PanelLeftOpen : PanelRightOpen
	return (
		<div className="border-border bg-muted/30 flex h-8 w-full shrink-0 items-center justify-center border-b lg:h-auto lg:w-8 lg:border-b-0">
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={() => setLayout("split")}
				aria-label={`Restore ${pane} pane`}
				title={`Restore ${pane} pane`}
			>
				<Icon className="size-3.5" />
			</Button>
		</div>
	)
}

function WorkbenchSeparator({
	isDesktop,
	split,
	setSplit,
	layoutRef,
	isResizing,
}: {
	isDesktop: boolean
	split: number
	setSplit: (split: number | ((split: number) => number)) => void
	layoutRef: RefObject<HTMLDivElement | null>
	isResizing: MutableRefObject<boolean>
}) {
	return (
		<div
			role="separator"
			tabIndex={0}
			aria-orientation={isDesktop ? "vertical" : "horizontal"}
			aria-valuemin={25}
			aria-valuemax={75}
			aria-valuenow={Math.round(split)}
			aria-valuetext={`Source pane ${Math.round(split)}%`}
			aria-label="Resize source and preview panes"
			className="group bg-border/60 hover:bg-primary focus-visible:bg-primary h-2 w-full shrink-0 cursor-row-resize touch-none outline-none lg:h-full lg:w-2 lg:cursor-col-resize"
			onPointerDown={makeSeparatorPointerDown(
				isDesktop,
				layoutRef,
				isResizing,
				setSplit,
			)}
			onPointerMove={makeSeparatorPointerMove(
				isDesktop,
				layoutRef,
				isResizing,
				setSplit,
			)}
			onPointerUp={makeSeparatorPointerUp(isResizing)}
			onPointerCancel={makeSeparatorPointerUp(isResizing)}
			onKeyDown={makeSeparatorKeyDown(isDesktop, setSplit)}
		/>
	)
}

function makeSeparatorPointerDown(
	isDesktop: boolean,
	layoutRef: RefObject<HTMLDivElement | null>,
	isResizing: MutableRefObject<boolean>,
	setSplit: (split: number | ((split: number) => number)) => void,
) {
	return function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
		event.preventDefault()
		event.stopPropagation()
		isResizing.current = true
		event.currentTarget.setPointerCapture(event.pointerId)
		setSplitFromPointer(event, isDesktop, layoutRef, setSplit)
	}
}

function makeSeparatorPointerMove(
	isDesktop: boolean,
	layoutRef: RefObject<HTMLDivElement | null>,
	isResizing: MutableRefObject<boolean>,
	setSplit: (split: number | ((split: number) => number)) => void,
) {
	return function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
		if (!isResizing.current) return
		event.preventDefault()
		event.stopPropagation()
		setSplitFromPointer(event, isDesktop, layoutRef, setSplit)
	}
}

function makeSeparatorPointerUp(isResizing: MutableRefObject<boolean>) {
	return function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
		isResizing.current = false
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId)
		}
	}
}

function setSplitFromPointer(
	event: PointerEvent<HTMLDivElement>,
	isDesktop: boolean,
	layoutRef: RefObject<HTMLDivElement | null>,
	setSplit: (split: number | ((split: number) => number)) => void,
) {
	let layout = layoutRef.current
	if (!layout) return
	let rect = layout.getBoundingClientRect()
	let length = isDesktop ? rect.width : rect.height
	if (length === 0) return
	let position = isDesktop
		? event.clientX - rect.left
		: event.clientY - rect.top
	setSplit(clampSplit((position / length) * 100))
}

function makeSeparatorKeyDown(
	isDesktop: boolean,
	setSplit: (split: number | ((split: number) => number)) => void,
) {
	return function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		let change = getSplitKeyChange(event.key, isDesktop)
		if (change === null) return
		event.preventDefault()
		event.stopPropagation()
		if (change === "min") {
			setSplit(25)
			return
		}
		if (change === "max") {
			setSplit(75)
			return
		}
		if (typeof change === "number") {
			setSplit(split => clampSplit(split + change))
		}
	}
}

function getSplitKeyChange(key: string, isDesktop: boolean) {
	if (key === "Home") return "min"
	if (key === "End") return "max"
	if (key === (isDesktop ? "ArrowLeft" : "ArrowUp")) return -5
	if (key === (isDesktop ? "ArrowRight" : "ArrowDown")) return 5
	return null
}

function clampSplit(value: number) {
	return Math.min(75, Math.max(25, value))
}

function PreviewModeControl({
	mode,
	setMode,
}: {
	mode: PreviewMode
	setMode: (mode: PreviewMode) => void
}) {
	return (
		<div className="flex items-center">
			<Button
				variant={mode === "document" ? "secondary" : "ghost"}
				size="sm"
				className="w-7 px-0"
				onClick={() => setMode("document")}
				aria-label="Document preview"
				title="Document preview"
				aria-pressed={mode === "document"}
			>
				<FileText className="size-3.5" />
			</Button>
			<Button
				variant={mode === "slideshow" ? "secondary" : "ghost"}
				size="sm"
				className="w-7 px-0"
				onClick={() => setMode("slideshow")}
				aria-label="Slideshow preview"
				title="Slideshow preview"
				aria-pressed={mode === "slideshow"}
			>
				<MonitorPlay className="size-3.5" />
			</Button>
		</div>
	)
}

function AppearanceControl({
	appearance,
	setAppearance,
}: {
	appearance: "light" | "dark"
	setAppearance: (appearance: "light" | "dark") => void
}) {
	return (
		<div className="flex items-center">
			<Button
				variant={appearance === "light" ? "secondary" : "ghost"}
				size="icon-sm"
				onClick={() => setAppearance("light")}
				aria-label="Light preview"
				aria-pressed={appearance === "light"}
			>
				<Sun className="size-3.5" />
			</Button>
			<Button
				variant={appearance === "dark" ? "secondary" : "ghost"}
				size="icon-sm"
				onClick={() => setAppearance("dark")}
				aria-label="Dark preview"
				aria-pressed={appearance === "dark"}
			>
				<Moon className="size-3.5" />
			</Button>
		</div>
	)
}

function makeTargetChange(
	setTarget: (target: PreviewTarget) => void,
	setSlideNumber: (slideNumber: number) => void,
) {
	return function handleTargetChange(value: string | null) {
		setTarget(value ?? "sample")
		setSlideNumber(1)
	}
}

function getSlides(items: PresentationItem[]): Slide[] {
	let slideMap = new Map<number, Slide["blocks"]>()
	for (let item of items) {
		if (item.type !== "block") continue
		let blocks = slideMap.get(item.slideNumber) ?? []
		blocks.push(item.block)
		slideMap.set(item.slideNumber, blocks)
	}
	return Array.from(slideMap.entries())
		.sort((a, b) => a[0] - b[0])
		.map(([slideNumber, blocks]) => ({ slideNumber, blocks }))
}

function getTargetDocuments(account: LoadedAccount, sourceId: string) {
	if (!account.$isLoaded || !account.root?.documents?.$isLoaded) return []
	return Array.from(account.root.documents).filter(
		(document): document is co.loaded<typeof Document, { content: true }> =>
			document?.$isLoaded === true &&
			document.$jazz.id !== sourceId &&
			getThemeSourceId(document.content.toString()) === null,
	)
}

function makeSourceChange(
	themeId: string,
	source: LoadedSource,
	account: LoadedAccount,
	setSourceSyncError: (error: string | null) => void,
	sourceSyncState: MutableRefObject<{ content: string; sequence: number }>,
) {
	return function handleSourceChange(readContent: () => string) {
		let sequence = sourceSyncState.current.sequence + 1
		sourceSyncState.current.sequence = sequence
		let content: string
		try {
			content = persistDocumentContentSynchronously(
				source,
				bindThemeSource(readContent(), themeId),
			)
			sourceSyncState.current.content = content
		} catch (error) {
			if (sourceSyncState.current.sequence === sequence) {
				setSourceSyncError(getSourceSyncError(error))
			}
			return
		}
		void syncThemeFromSource(account, source.$jazz.id, content).then(
			() => {
				if (sourceSyncState.current.sequence === sequence) {
					setSourceSyncError(null)
				}
			},
			error => {
				if (sourceSyncState.current.sequence === sequence) {
					setSourceSyncError(getSourceSyncError(error))
				}
			},
		)
	}
}

function getSourceSyncError(error: unknown) {
	return error instanceof Error
		? error.message
		: "Theme source could not be saved."
}

function SourceSyncError({ error }: { error: string | null }) {
	if (!error) return null

	return (
		<div className="bg-destructive/10 border-destructive/20 text-destructive shrink-0 border-t px-3 py-2 text-xs">
			{error}
		</div>
	)
}

function SourceErrors({
	errors,
	source,
	editor,
}: {
	errors: ReturnType<typeof parseThemeSource>["errors"]
	source: string
	editor: RefObject<MarkdownEditorRef | null>
}) {
	if (errors.length === 0) return null

	return (
		<div className="bg-destructive/10 border-destructive/20 shrink-0 border-t px-3 py-2">
			{errors.map(error => (
				<button
					key={`${error.line}-${error.message}`}
					type="button"
					onClick={makeJumpToLine(source, error.line, editor)}
					className="text-destructive flex w-full items-start gap-2 text-left text-xs"
				>
					<AlertCircle className="mt-0.5 size-3.5 shrink-0" />
					<span>
						Line {error.line}: {error.message}. Preview keeps the last valid
						theme.
					</span>
				</button>
			))}
		</div>
	)
}

function makeJumpToLine(
	source: string,
	line: number,
	editor: RefObject<MarkdownEditorRef | null>,
) {
	return function handleJumpToLine() {
		let view = editor.current?.getEditor()
		if (!view) return
		let start = source
			.split("\n")
			.slice(0, line - 1)
			.join("\n").length
		if (line > 1) start++
		let end = source.indexOf("\n", start)
		view.focus()
		view.dispatch({
			selection: { anchor: start, head: end < 0 ? source.length : end },
			scrollIntoView: true,
		})
	}
}
