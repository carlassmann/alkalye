import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { MarkdownEditor, type MarkdownEditorRef } from "@/app/features/editor"
import {
	SlideshowView,
	getSlides,
	parsePresentation,
	type PresentationItem,
} from "@/app/features/presentation"
import { CommentThreadCard, CommentsPanel } from "@/app/features/comments"
import {
	TimeMachineBottomBar,
	TimeMachineToolbar,
} from "@/app/features/time-machine"
import { resolveSyntaxTheme } from "@/app/features/syntax-highlighting"
import type { ResolvedTheme } from "@/app/features/themes"
import { CanvasErrorBoundary, type TldrawSave } from "@/app/features/assets"
import { cn } from "@/app/lib/cn"
import type { LandingLocale } from "#www/landing-content"
import {
	demoFrameAt,
	demoScenes,
	demoSketch,
	type DemoCollaborator,
	type DemoComment,
	type DemoFrame,
	type DemoSceneId,
	type DemoStageLabels,
	type DemoVersion,
	type DemoView,
} from "./demo-script"
import { DemoChrome } from "./demo-chrome"
import { DemoEditorPane } from "./demo-editor-pane"
import { DemoPhone } from "./demo-phone"
import type { DemoPhoneScreen, PhoneMessage } from "./demo-phone-protocol"
import { DemoProviders } from "./demo-providers"
import { forwardWheel } from "./forward-wheel"
import {
	applyVisitorEdit,
	diffVisitorEdit,
	type VisitorEdit,
} from "./visitor-edit"

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

interface DemoStageProps {
	locale: LandingLocale
	labels: DemoStageLabels
}

function DemoStageRoot(props: DemoStageProps) {
	return (
		<DemoProviders locale={props.locale}>
			<DemoStage {...props} />
		</DemoProviders>
	)
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
	let visitor = useVisitor(frame)
	let people = uniqueCollaborators([
		...scenes
			.slice(0, position.sceneIndex + 1)
			.flatMap(scene => [
				...(scene.by ? [scene.by] : []),
				...(scene.watchers ?? []),
				...(scene.comments ?? []).map(comment => comment.by),
			]),
		...(visitor.hasJoined
			? [{ name: labels.you, color: visitorColor, device: "visitor" as const }]
			: []),
	])
	let isEditing = frame.view === "editor" || frame.view === "review"
	let introIsTyping = position.sceneIndex === 0 && introProgress < 1
	let talk = talkAt(frame, visitor, appearance)
	// The phone loads once the intro has typed, so it never delays the hero.
	let phoneIsLoaded = !introIsTyping || position.sceneIndex > 0
	let phoneIsShown = phoneScenes.has(frame.sceneId)

	function handlePhone(message: PhoneMessage) {
		if (message.type === "typed") visitor.type(message.content)
		if (message.type === "index") visitor.pickTalkIndex(message.index)
		if (message.type === "wheel") scrollPage(message.deltaY)
	}

	let root = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (root.current) return forwardWheel(root.current, scrollPage)
	}, [])

	return (
		<div ref={root} className="@container relative flex h-full w-full">
			<div
				className={cn(
					"flex min-w-0 flex-1 transition-[margin] duration-700 ease-out",
					phoneIsShown && "@3xl:mr-[27%]",
				)}
			>
				<DemoChrome
					labels={labels}
					view={frame.view}
					people={people}
					interactive={visitor.isInteractive}
					hint={
						visitor.wantsHint && !introIsTyping
							? labels.hints[frame.view]
							: null
					}
					onActivate={() => {
						if (frame.view === "present") {
							visitor.pickTalkIndex(nextSlideStart(talk.items, talk.index))
						}
						visitor.activate()
					}}
					onLeave={visitor.leave}
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
							visitor={visitor}
							talk={talk}
							appearance={appearance}
							locale={locale}
						/>
					</div>
				</DemoChrome>
			</div>
			{phoneIsLoaded && (
				<div
					// Beside the Mac when there is room, in front of its corner when not.
					className={cn(
						"absolute right-1 bottom-1 h-[62%] transition duration-700 ease-out motion-reduce:transition-none @3xl:top-[2%] @3xl:right-0 @3xl:bottom-auto @3xl:h-[96%]",
						phoneIsShown
							? "translate-x-0 opacity-100"
							: "pointer-events-none translate-x-12 opacity-0",
					)}
					aria-hidden={!phoneIsShown}
				>
					<DemoPhone
						locale={locale}
						screen={phoneScreen(frame, visitor, talk)}
						onMessage={handlePhone}
					/>
				</div>
			)}
		</div>
	)
}

// Scenes where Carl has the phone in hand.
let phoneScenes = new Set<DemoSceneId>(["devices", "toomuch", "present"])

function phoneScreen(
	frame: DemoFrame,
	visitor: Visitor,
	talk: Talk,
): DemoPhoneScreen {
	if (frame.view === "present") {
		return {
			kind: "teleprompter",
			content: talk.content,
			presentationIndex: talk.index,
		}
	}
	return {
		kind: "editor",
		content: visitor.personalize(frame.content),
		// The phone shows everyone else; its own caret is the screen itself.
		cursors: frame.cursors
			.filter(cursor => cursor.collaborator.device !== "phone")
			.map(cursor => ({
				...cursor,
				position: visitor.mapPosition(frame.content, cursor.position),
			})),
	}
}

interface Talk {
	content: string
	items: PresentationItem[]
	// The teleprompter paragraph the speaker is on; the slide follows it.
	index: number
}

function talkAt(
	frame: DemoFrame,
	visitor: Visitor,
	appearance: "light" | "dark",
): Talk {
	let content = visitor.personalize(frame.content, appearance)
	let items = frame.view === "present" ? parsePresentation(content) : []
	let scripted = stepIndex(frame.viewProgress, items.length)
	let index = Math.min(
		visitor.talkIndex(scripted),
		Math.max(items.length - 1, 0),
	)
	return { content, items, index }
}

function nextSlideStart(items: PresentationItem[], index: number): number {
	let slideNumber = items[index]?.slideNumber ?? 0
	let next = items.findIndex(item => item.slideNumber > slideNumber)
	return next === -1 ? 0 : next
}

let visitorColor = "#d97706"

interface VisitorDrawing {
	save: TldrawSave
	lightUrl: string
	darkUrl: string
}

// A visitor choice made at one point of the script, dropped once the
// script moves on.
interface Pinned<T> {
	at: string
	value: T
}

type Visitor = ReturnType<typeof useVisitor>

// Everything visitors do stays in memory. Their text and sketch carry
// through the rest of the story; slider and slide clicks last until the
// next scroll.
function useVisitor(frame: DemoFrame) {
	let [edit, setEdit] = useState<VisitorEdit | null>(null)
	let [drawing, setDrawing] = useState<VisitorDrawing | null>(null)
	let [drawingScene, setDrawingScene] = useState<DemoSceneId | null>(null)
	let [historyPin, setHistoryPin] = useState<Pinned<number> | null>(null)
	let [talkPin, setTalkPin] = useState<Pinned<number> | null>(null)
	let scriptPoint = `${frame.sceneId}:${frame.history?.index ?? ""}:${frame.viewProgress}`
	let isDrawing = drawingScene === frame.sceneId

	useEffect(() => {
		if (!drawing) return
		return () => {
			URL.revokeObjectURL(drawing.lightUrl)
			URL.revokeObjectURL(drawing.darkUrl)
		}
	}, [drawing])

	let used: Record<DemoView, boolean> = {
		editor: edit !== null,
		review: edit !== null,
		whiteboard: drawing !== null || isDrawing,
		timemachine: historyPin !== null,
		present: talkPin !== null,
	}

	return {
		hasJoined: Object.values(used).some(Boolean),
		wantsHint: !used[frame.view],
		isInteractive:
			frame.view === "editor" ||
			frame.view === "review" ||
			frame.view === "timemachine" ||
			isDrawing,
		isDrawing,
		drawing,
		personalize(content: string, appearance?: "light" | "dark") {
			let personal = edit ? applyVisitorEdit(content, edit).content : content
			if (!drawing || !appearance) return personal
			let url = appearance === "dark" ? drawing.darkUrl : drawing.lightUrl
			return personal.replace(/\/demo\/sketch(-de)?\.svg/, url)
		},
		mapPosition(content: string, position: number) {
			return edit
				? applyVisitorEdit(content, edit).mapPosition(position)
				: position
		},
		type(edited: string) {
			setEdit(diffVisitorEdit(frame.content, edited))
		},
		draw(save: TldrawSave) {
			setDrawing({
				save,
				lightUrl: URL.createObjectURL(save.lightPreview),
				darkUrl: URL.createObjectURL(save.darkPreview),
			})
		},
		historyIndex(scripted: number) {
			return historyPin?.at === scriptPoint ? historyPin.value : scripted
		},
		pickVersion(index: number) {
			setHistoryPin({ at: scriptPoint, value: index })
		},
		talkIndex(scripted: number) {
			return talkPin?.at === scriptPoint ? talkPin.value : scripted
		},
		pickTalkIndex(index: number) {
			setTalkPin({ at: scriptPoint, value: index })
		},
		activate() {
			if (frame.view === "whiteboard") setDrawingScene(frame.sceneId)
		},
		leave() {
			setDrawingScene(null)
		},
	}
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
	visitor,
	talk,
	appearance,
	locale,
}: {
	frame: DemoFrame
	visitor: Visitor
	talk: Talk
	appearance: "light" | "dark"
	locale: LandingLocale
}) {
	if (frame.view === "editor" || frame.view === "review") {
		return <DemoEditor frame={frame} visitor={visitor} />
	}
	if (frame.view === "timemachine" && frame.history) {
		return <DemoTimeMachine history={frame.history} visitor={visitor} />
	}
	if (frame.view === "present") {
		return <DemoPresent talk={talk} appearance={appearance} />
	}
	return (
		<CanvasErrorBoundary fallback={null}>
			<Suspense fallback={null}>
				<DemoWhiteboard
					progress={frame.viewProgress}
					labels={demoSketch(locale)}
					drawing={visitor.drawing?.save ?? null}
					isDrawing={visitor.isDrawing}
					onDrawingChange={visitor.draw}
				/>
			</Suspense>
		</CanvasErrorBoundary>
	)
}

function DemoEditor({
	frame,
	visitor,
}: {
	frame: DemoFrame
	visitor: Visitor
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
			<DemoEditorPane
				content={visitor.personalize(frame.content)}
				cursors={frame.cursors.map(cursor => ({
					...cursor,
					position: visitor.mapPosition(frame.content, cursor.position),
				}))}
				comments={frame.comments}
				onType={visitor.type}
			/>
			{frame.view === "review" && <DemoComments comments={frame.comments} />}
		</div>
	)
}

// The app's comment sidebar, filled with the agent's review.
function DemoComments({ comments }: { comments: DemoComment[] }) {
	let [collapsed, setCollapsed] = useState<Set<string>>(new Set())
	function toggle(id: string) {
		setCollapsed(previous => {
			let next = new Set(previous)
			if (!next.delete(id)) next.add(id)
			return next
		})
	}
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
							collapsed={collapsed.has(comment.id)}
							onToggleCollapsed={() => toggle(comment.id)}
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
	visitor,
}: {
	history: { versions: DemoVersion[]; index: number }
	visitor: Visitor
}) {
	let editor = useRef<MarkdownEditorRef>(null)
	let [now] = useState(() => new Date())
	let index = visitor.historyIndex(history.index)
	let version = history.versions[index]
	let editHistory = history.versions.map((entry, index) => ({
		index,
		madeAt: editDate(now, entry, index),
		accountId: entry.by.name,
		key: `demo-${index}`,
		content: entry.content,
	}))

	return (
		<div className="relative min-h-0 flex-1 [transform:translateZ(0)] overflow-hidden [&_.cm-scroller]:overflow-hidden!">
			<div className="markdown-editor">
				<MarkdownEditor
					ref={editor}
					value={visitor.personalize(version?.content ?? "")}
					onChange={() => {}}
					readOnly
					typeToFocus={false}
					spellcheck={false}
					autocomplete={false}
				/>
				<TimeMachineToolbar
					editDate={editHistory[index]?.madeAt ?? now}
					authorName={version?.by.name ?? ""}
					onExit={() => {}}
					onCreateCopy={() => {}}
					onRestore={() => {}}
				/>
				<TimeMachineBottomBar
					editHistory={editHistory}
					editParam={index}
					onEditChange={visitor.pickVersion}
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

// The Mac shows the slides; the phone beside it is the teleprompter.
function DemoPresent({
	talk,
	appearance,
}: {
	talk: Talk
	appearance: "light" | "dark"
}) {
	let slides = getSlides(talk.items)
	let syntaxTheme = resolveSyntaxTheme({
		content: talk.content,
		defaultFamilyId: undefined,
		appearance,
	})

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<SlideshowView
				content={talk.content}
				slides={slides}
				wikilinks={noWikilinks}
				currentSlideNumber={talk.items[talk.index]?.slideNumber ?? 1}
				appearance={appearance}
				documentTheme={builtInDocumentTheme}
				syntaxTheme={syntaxTheme}
				embedded
			/>
		</div>
	)
}

// The landing page scrolls its body; the stage sits inside it.
function scrollPage(deltaY: number) {
	let stage = document.querySelector("[data-demo-stage]")
	scrollableAncestor(stage)?.scrollBy(0, deltaY)
}

function scrollableAncestor(element: Element | null): Element | null {
	for (let current = element; current; current = current.parentElement) {
		let { overflowY } = getComputedStyle(current)
		let canScroll = overflowY === "auto" || overflowY === "scroll"
		if (canScroll && current.scrollHeight > current.clientHeight) return current
	}
	return document.scrollingElement
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
			let focusLine = window.innerHeight * 0.5
			let stage = document.querySelector("[data-demo-stage]")
			if (stage instanceof HTMLElement && elements[0]) {
				stage.style.setProperty(
					"--demo-expand",
					String(stageExpansion(elements[0].getBoundingClientRect())),
				)
			}
			let sceneIndex = 0
			for (let [index, element] of elements.entries()) {
				if (element.getBoundingClientRect().top <= focusLine) sceneIndex = index
			}
			let scene = elements[sceneIndex]
			let progress = scene
				? (focusLine - scene.getBoundingClientRect().top) /
					Math.max(sceneLength(scene), 1)
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

// The stage widens over the hero's column while the hero scrolls away.
// A scene lasts for its note plus the margin below it.
function sceneLength(scene: HTMLElement): number {
	return scene.offsetHeight + parseFloat(getComputedStyle(scene).marginBottom)
}

function stageExpansion(hero: DOMRect): number {
	let viewport = window.innerHeight
	let expansion = (viewport * 0.9 - hero.bottom) / (viewport * 0.6)
	return Math.max(0, Math.min(expansion, 1))
}
