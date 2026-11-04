import { lazy, Suspense, useEffect, useRef, useState } from "react"
import {
	RouterProvider,
	createMemoryHistory,
	createRootRoute,
	createRouter,
} from "@tanstack/react-router"
import {
	EditorToolbar,
	MarkdownEditor,
	type MarkdownEditorRef,
} from "@/app/features/editor"
import {
	SlideshowView,
	Teleprompter,
	getSlides,
	parsePresentation,
} from "@/app/features/presentation"
import {
	remoteCursorsExtension,
	setRemoteCursorsEffect,
} from "@/app/features/sharing"
import {
	CommentThreadCard,
	CommentsPanel,
	commentsExtension,
	setCommentDecorationsEffect,
} from "@/app/features/comments"
import {
	TimeMachineBottomBar,
	TimeMachineToolbar,
} from "@/app/features/time-machine"
import { resolveSyntaxTheme } from "@/app/features/syntax-highlighting"
import type { ResolvedTheme } from "@/app/features/themes"
import { CanvasErrorBoundary } from "@/app/features/assets"
import { cn } from "@/app/lib/cn"
import { SidebarProvider } from "@/app/components/ui/sidebar"
import { IntlProvider } from "@/shared/intl/setup"
import { messagesDe } from "@/shared/intl/messages"
import type { LandingLocale } from "#www/landing-content"
import {
	demoFrameAt,
	demoScenes,
	demoSketch,
	type DemoCollaborator,
	type DemoComment,
	type DemoCursor,
	type DemoFrame,
	type DemoSceneId,
	type DemoStageLabels,
	type DemoVersion,
} from "./demo-script"
import { DemoChrome } from "./demo-chrome"

export { DemoStageRoot }

let DemoWhiteboard = lazy(() =>
	loadDemoWhiteboard().then(module => ({ default: module.DemoWhiteboard })),
)

// The website has no account, so documents render with the built-in theme.
let builtInDocumentTheme: ResolvedTheme = {
	theme: null,
	preset: null,
	warning: null,
	isLoading: false,
}
let noWikilinks = new Map()
let noCursors: DemoCursor[] = []
// Comments are read-only here, so selecting one does nothing.
let editorExtensions = [remoteCursorsExtension, commentsExtension(() => {})]

interface DemoStageProps {
	locale: LandingLocale
	labels: DemoStageLabels
}

function DemoStageRoot(props: DemoStageProps) {
	let { locale } = props
	let [router] = useState(() => createDemoRouter(props))
	let stage = <RouterProvider router={router} />
	return locale === "de" ? (
		<IntlProvider messages={messagesDe} locale="de">
			{stage}
		</IntlProvider>
	) : (
		<IntlProvider>{stage}</IntlProvider>
	)
}

// The editor keeps find state in the route search and reads sidebar layout.
// A memory router and sidebar context give it both without touching the page URL.
function createDemoRouter(props: DemoStageProps) {
	return createRouter({
		routeTree: createRootRoute({
			component: () => (
				// The app's sidebar state must not shift or change the demo.
				<SidebarProvider
					data-left-sidebar-open={false}
					data-right-sidebar-open={false}
				>
					<DemoStage {...props} />
				</SidebarProvider>
			),
		}),
		history: createMemoryHistory(),
	})
}

function DemoStage({ locale, labels }: DemoStageProps) {
	let scenes = demoScenes(locale)
	let position = useScrollPosition(scenes.map(scene => scene.id))
	let introProgress = useIntroClock()
	let progress =
		position.sceneIndex === 0
			? Math.max(position.progress, introProgress)
			: position.progress
	let frame = demoFrameAt(scenes, position.sceneIndex, progress)
	let appearance = useDocumentAppearance()
	usePrefetchAfterIntro(loadDemoWhiteboard)
	let people = uniqueCollaborators(
		scenes
			.slice(0, position.sceneIndex + 1)
			.flatMap(scene => [
				...(scene.by ? [scene.by] : []),
				...(scene.watchers ?? []),
				...(scene.comments ?? []).map(comment => comment.by),
			]),
	)
	let isEditing = frame.view === "editor" || frame.view === "review"

	return (
		<DemoChrome
			labels={labels}
			view={frame.view}
			people={people}
			interactive={isEditing}
		>
			<div
				// The editor stays mounted while comments open beside it.
				key={isEditing ? "editor" : frame.view}
				className={cn(
					"animate-in fade-in-30 zoom-in-[0.98] flex min-h-0 min-w-0 flex-1 flex-col duration-500 ease-out motion-reduce:animate-none",
					// Phones see more of each view at a smaller size. tldraw has its
					// own camera and measures wrong under CSS zoom.
					frame.view !== "whiteboard" && "max-sm:[zoom:0.8]",
				)}
			>
				<DemoViewContent
					frame={frame}
					appearance={appearance}
					locale={locale}
				/>
			</div>
		</DemoChrome>
	)
}

function uniqueCollaborators(people: DemoCollaborator[]): DemoCollaborator[] {
	return [...new Map(people.map(person => [person.name, person])).values()]
}

// Loading tldraw at the switch would blank the stage for a moment, so it
// loads once the intro has finished typing. Safari has no requestIdleCallback.
function usePrefetchAfterIntro(load: () => Promise<unknown>) {
	useEffect(() => {
		let timer = setTimeout(() => void load(), introDelayMs + introDurationMs)
		return () => clearTimeout(timer)
	}, [load])
}

function loadDemoWhiteboard() {
	return import("./demo-whiteboard")
}

// The hero types its first lines on its own, so visitors see the editor
// move before they scroll.
let introDelayMs = 500
let introDurationMs = 3200

function useIntroClock(): number {
	let [progress, setProgress] = useState(0)

	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setProgress(1)
			return
		}
		let start = performance.now() + introDelayMs
		let frame = requestAnimationFrame(function tick(now) {
			let next = Math.max(0, Math.min((now - start) / introDurationMs, 1))
			setProgress(next)
			if (next < 1) frame = requestAnimationFrame(tick)
		})
		return () => cancelAnimationFrame(frame)
	}, [])

	return progress
}

function DemoViewContent({
	frame,
	appearance,
	locale,
}: {
	frame: DemoFrame
	appearance: "light" | "dark"
	locale: LandingLocale
}) {
	if (frame.view === "editor" || frame.view === "review") {
		return <DemoEditor frame={frame} />
	}
	if (frame.view === "timemachine" && frame.history) {
		return <DemoTimeMachine history={frame.history} />
	}
	if (frame.view === "present") {
		return <DemoPresent frame={frame} appearance={appearance} />
	}
	return (
		<CanvasErrorBoundary fallback={null}>
			<Suspense fallback={null}>
				<DemoWhiteboard
					progress={frame.viewProgress}
					labels={demoSketch(locale)}
				/>
			</Suspense>
		</CanvasErrorBoundary>
	)
}

// Visitors can type into the demo. Their draft replaces the scripted text
// until the next scene, and stays in memory only.
interface VisitorDraft {
	sceneId: DemoSceneId
	text: string
}

function DemoEditor({ frame }: { frame: DemoFrame }) {
	let editor = useRef<MarkdownEditorRef>(null)
	let [draft, setDraft] = useState<VisitorDraft | null>(null)
	let visitorText = draft?.sceneId === frame.sceneId ? draft.text : null
	let content = visitorText ?? frame.content
	let cursors = visitorText === null ? frame.cursors : noCursors
	let comments = frame.comments
	let typist = cursors.at(-1)

	useEffect(() => {
		let retry = 0
		function showCollaborators() {
			// The editor creates its view after its first render.
			let view = editor.current?.getEditor()
			if (!view) {
				retry = requestAnimationFrame(showCollaborators)
				return
			}
			let text = view.state.doc.toString()
			view.dispatch({
				effects: [
					setRemoteCursorsEffect.of(cursors.map(remoteCursor)),
					setCommentDecorationsEffect.of(commentRanges(comments, text)),
				],
			})
			if (!typist) return
			// Scroll only the editor; CodeMirror's scrollIntoView would also move the page.
			let line = view.lineBlockAt(Math.min(typist.position, text.length))
			view.scrollDOM.scrollTop = line.top - view.scrollDOM.clientHeight / 2
		}
		showCollaborators()
		return () => cancelAnimationFrame(retry)
	}, [cursors, comments, typist, content])

	return (
		<div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
			{/* The app pins its toolbar and editor to the window. The transform
			    makes this stage their window. The scroller stays hidden so wheel
			    and touch scroll the page, which drives the demo. */}
			<div className="relative min-h-0 flex-1 [transform:translateZ(0)] overflow-hidden [&_.cm-scroller]:overflow-hidden!">
				<div className="markdown-editor">
					<MarkdownEditor
						ref={editor}
						value={content}
						onChange={readContent => {
							// Scripted updates also report a change; only the visitor focuses.
							if (!editor.current?.getEditor()?.hasFocus) return
							setDraft({ sceneId: frame.sceneId, text: readContent() })
						}}
						extensions={editorExtensions}
						typeToFocus={false}
						spellcheck={false}
						autocomplete={false}
					/>
					<EditorToolbar
						editor={editor}
						onToggleLeftSidebar={ignoreSidebarToggle}
						onToggleRightSidebar={ignoreSidebarToggle}
					/>
				</div>
			</div>
			{frame.view === "review" && <DemoComments comments={comments} />}
		</div>
	)
}

// The demo has no document list or settings to open.
function ignoreSidebarToggle() {}

function remoteCursor({ collaborator, position }: DemoCursor) {
	return {
		id: collaborator.name,
		sessionId: collaborator.name,
		name: collaborator.name,
		color: collaborator.color,
		position,
	}
}

function commentRanges(comments: DemoComment[], text: string) {
	return comments.flatMap(comment => {
		let from = text.indexOf(comment.quote)
		if (from === -1) return []
		return [
			{
				id: comment.id,
				from,
				to: from + comment.quote.length,
				resolved: false,
				selected: false,
				orphaned: false,
			},
		]
	})
}

// The app's comment sidebar, filled with the agent's review.
function DemoComments({ comments }: { comments: DemoComment[] }) {
	return (
		<aside className="border-border bg-sidebar animate-in fade-in slide-in-from-right-4 flex max-h-[45%] shrink-0 flex-col border-t duration-500 @2xl:max-h-none @2xl:w-64 @2xl:border-t-0 @2xl:border-l">
			<CommentsPanel unresolvedCount={comments.length}>
				<div className="space-y-1 p-2">
					{comments.map(comment => (
						<CommentThreadCard
							key={comment.id}
							className="animate-in fade-in slide-in-from-top-1 duration-500"
							quote={comment.quote}
							replies={[
								{
									id: comment.id,
									authorName: comment.by.name,
									body: comment.body,
								},
							]}
							resolved={false}
							selected={false}
							collapsed={false}
							onToggleCollapsed={() => {}}
							onSelect={() => {}}
						/>
					))}
				</div>
			</CommentsPanel>
		</aside>
	)
}

function DemoTimeMachine({
	history,
}: {
	history: { versions: DemoVersion[]; index: number }
}) {
	let editor = useRef<MarkdownEditorRef>(null)
	let [now] = useState(() => new Date())
	let version = history.versions[history.index]
	let editHistory = history.versions.map((entry, index) => ({
		index,
		madeAt: editDate(now, entry, index),
		accountId: entry.by.name,
		contentId: `demo-${index}`,
		generationIndex: index,
	}))

	return (
		<div className="relative min-h-0 flex-1 [transform:translateZ(0)] overflow-hidden [&_.cm-scroller]:overflow-hidden!">
			<div className="markdown-editor">
				<MarkdownEditor
					ref={editor}
					value={version?.content ?? ""}
					onChange={() => {}}
					readOnly
					typeToFocus={false}
					spellcheck={false}
					autocomplete={false}
				/>
				<TimeMachineToolbar
					editDate={editHistory[history.index]?.madeAt ?? now}
					authorName={version?.by.name ?? ""}
					onExit={() => {}}
					onCreateCopy={() => {}}
					onRestore={() => {}}
				/>
				<TimeMachineBottomBar
					editHistory={editHistory}
					editParam={history.index}
					onEditChange={() => {}}
				/>
			</div>
		</div>
	)
}

// Versions spread over the days they were made, minutes apart within a day.
function editDate(now: Date, version: DemoVersion, index: number): Date {
	let date = new Date(now)
	date.setDate(date.getDate() - version.daysAgo)
	date.setHours(9, index * 7, 0, 0)
	return date
}

// The Mac shows the slides, the phone in hand shows the speaker notes.
function DemoPresent({
	frame,
	appearance,
}: {
	frame: DemoFrame
	appearance: "light" | "dark"
}) {
	let items = parsePresentation(frame.content)
	let slides = getSlides(items)
	let slide = slides[stepIndex(frame.viewProgress, slides.length)]
	let slideNumber = slide?.slideNumber ?? 1
	let syntaxTheme = resolveSyntaxTheme({
		content: frame.content,
		defaultFamilyId: undefined,
		appearance,
	})

	return (
		<div className="bg-muted/40 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-4 @lg:flex-row @lg:gap-6 @lg:p-6">
			<div className="border-border flex aspect-[16/10] max-h-full w-full min-w-0 flex-col overflow-hidden border shadow-lg @lg:w-auto @lg:flex-1">
				<SlideshowView
					content={frame.content}
					slides={slides}
					wikilinks={noWikilinks}
					currentSlideNumber={slideNumber}
					appearance={appearance}
					documentTheme={builtInDocumentTheme}
					syntaxTheme={syntaxTheme}
					embedded
				/>
			</div>
			<div className="border-foreground/80 bg-background flex aspect-[9/16] h-[45%] shrink-0 flex-col overflow-hidden rounded-[1.25rem] border-[5px] shadow-lg @lg:h-[85%]">
				<div className="flex min-h-0 flex-1 flex-col [zoom:0.6]">
					<Teleprompter
						inactive
						items={items}
						wikilinks={noWikilinks}
						presentationIndex={Math.max(
							items.findIndex(item => item.slideNumber === slideNumber),
							0,
						)}
						onIndexChange={() => {}}
					/>
				</div>
			</div>
		</div>
	)
}

function stepIndex(progress: number, count: number): number {
	if (count === 0) return 0
	return Math.min(Math.floor(progress * count), count - 1)
}

function useDocumentAppearance(): "light" | "dark" {
	let [appearance, setAppearance] = useState<"light" | "dark">(() =>
		document.documentElement.classList.contains("dark") ? "dark" : "light",
	)
	useEffect(() => {
		let query = window.matchMedia("(prefers-color-scheme: dark)")
		function update() {
			setAppearance(query.matches ? "dark" : "light")
		}
		query.addEventListener("change", update)
		return () => query.removeEventListener("change", update)
	}, [])
	return appearance
}

function useScrollPosition(sceneIds: string[]) {
	let [position, setPosition] = useState({ sceneIndex: 0, progress: 0 })
	let sceneKey = sceneIds.join(",")

	useEffect(() => {
		let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
		let elements = sceneKey
			.split(",")
			.map(id => document.querySelector(`[data-demo-scene="${id}"]`))
			.filter(element => element instanceof HTMLElement)
		let frame = 0

		function measure() {
			frame = 0
			let focusLine = sceneFocusLine(
				document.querySelector("[data-demo-stage]"),
			)
			let sceneIndex = 0
			for (let [index, element] of elements.entries()) {
				if (element.getBoundingClientRect().top <= focusLine) sceneIndex = index
			}
			let rect = elements[sceneIndex]?.getBoundingClientRect()
			let progress = rect
				? (focusLine - rect.top) / Math.max(rect.height, 1)
				: 0
			setPosition({
				sceneIndex,
				progress: reducedMotion.matches
					? 1
					: Math.max(0, Math.min(progress, 1)),
			})
		}

		function schedule() {
			if (!frame) frame = requestAnimationFrame(measure)
		}

		measure()
		// The landing page scrolls the body, not the window.
		document.addEventListener("scroll", schedule, {
			capture: true,
			passive: true,
		})
		window.addEventListener("resize", schedule)
		reducedMotion.addEventListener("change", schedule)
		return () => {
			cancelAnimationFrame(frame)
			document.removeEventListener("scroll", schedule, { capture: true })
			window.removeEventListener("resize", schedule)
			reducedMotion.removeEventListener("change", schedule)
		}
	}, [sceneKey])

	return position
}

// On phones the stage sits above the text, so scenes count from the space below it.
function sceneFocusLine(stage: Element | null): number {
	let viewportMiddle = window.innerHeight * 0.5
	if (!stage) return viewportMiddle
	let stageRect = stage.getBoundingClientRect()
	let stageIsBesideText = stageRect.width < window.innerWidth * 0.7
	if (stageIsBesideText) return viewportMiddle
	return stageRect.bottom + (window.innerHeight - stageRect.bottom) * 0.4
}
