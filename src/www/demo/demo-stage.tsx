import { lazy, Suspense, useEffect, useRef, useState } from "react"
import {
	RouterProvider,
	createMemoryHistory,
	createRootRoute,
	createRouter,
} from "@tanstack/react-router"
import { MarkdownEditor, type MarkdownEditorRef } from "@/app/features/editor"
import { PreviewView } from "@/app/features/documents"
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
import { resolveSyntaxTheme } from "@/app/features/syntax-highlighting"
import type { ResolvedTheme } from "@/app/features/themes"
import { SidebarProvider } from "@/app/components/ui/sidebar"
import { IntlProvider } from "@/shared/intl/setup"
import { messagesDe } from "@/shared/intl/messages"
import type { LandingLocale } from "#www/landing-content"
import { demoFrameAt, demoScenes, type DemoFrame } from "./demo-script"

export { DemoStageRoot }

let DemoWhiteboard = lazy(() =>
	import("./demo-whiteboard").then(module => ({
		default: module.DemoWhiteboard,
	})),
)

// The website has no account, so documents render with the built-in theme.
let builtInDocumentTheme: ResolvedTheme = {
	theme: null,
	preset: null,
	warning: null,
	isLoading: false,
}
let noWikilinks = new Map()
let editorExtensions = [remoteCursorsExtension]

function DemoStageRoot({ locale }: { locale: LandingLocale }) {
	let [router] = useState(() => createDemoRouter(locale))
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
function createDemoRouter(locale: LandingLocale) {
	return createRouter({
		routeTree: createRootRoute({
			component: () => (
				<SidebarProvider>
					<DemoStage locale={locale} />
				</SidebarProvider>
			),
		}),
		history: createMemoryHistory(),
	})
}

function DemoStage({ locale }: { locale: LandingLocale }) {
	let scenes = demoScenes(locale)
	let position = useScrollPosition(scenes.map(scene => scene.id))
	let frame = demoFrameAt(scenes, position.sceneIndex, position.progress)
	let appearance = useDocumentAppearance()

	return (
		<div
			data-demo-view={frame.view}
			className="border-border bg-background relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border shadow-xl shadow-black/5 dark:shadow-black/30"
		>
			<DemoView frame={frame} appearance={appearance} />
		</div>
	)
}

function DemoView({
	frame,
	appearance,
}: {
	frame: DemoFrame
	appearance: "light" | "dark"
}) {
	let syntaxTheme = resolveSyntaxTheme({
		content: frame.content,
		defaultFamilyId: undefined,
		appearance,
	})
	if (frame.view === "editor") return <DemoEditor frame={frame} />
	if (frame.view === "preview") {
		return (
			<div className="min-h-0 flex-1 overflow-auto">
				<PreviewView
					content={frame.content}
					wikilinks={noWikilinks}
					appearance={appearance}
					documentTheme={builtInDocumentTheme}
					syntaxTheme={syntaxTheme}
					embedded
				/>
			</div>
		)
	}
	if (frame.view === "slideshow") {
		let slides = getSlides(parsePresentation(frame.content))
		let slide = slides[stepIndex(frame.viewProgress, slides.length)]
		return (
			<SlideshowView
				content={frame.content}
				slides={slides}
				wikilinks={noWikilinks}
				currentSlideNumber={slide?.slideNumber ?? 1}
				appearance={appearance}
				documentTheme={builtInDocumentTheme}
				syntaxTheme={syntaxTheme}
				embedded
			/>
		)
	}
	if (frame.view === "teleprompter") {
		let items = parsePresentation(frame.content)
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<Teleprompter
					inactive
					items={items}
					wikilinks={noWikilinks}
					presentationIndex={stepIndex(frame.viewProgress, items.length)}
					onIndexChange={() => {}}
				/>
			</div>
		)
	}
	return (
		<Suspense fallback={null}>
			<DemoWhiteboard progress={frame.viewProgress} />
		</Suspense>
	)
}

function DemoEditor({ frame }: { frame: DemoFrame }) {
	let editor = useRef<MarkdownEditorRef>(null)
	let typist = frame.typist
	let typingAt = typist?.position ?? frame.content.length

	useEffect(() => {
		let retry = 0
		function showTypist() {
			// The editor creates its view after its first render.
			let view = editor.current?.getEditor()
			if (!view) {
				retry = requestAnimationFrame(showTypist)
				return
			}
			view.dispatch({
				effects: setRemoteCursorsEffect.of(
					typist
						? [
								{
									id: typist.collaborator.name,
									sessionId: typist.collaborator.name,
									name: typist.collaborator.name,
									color: typist.collaborator.color,
									position: typist.position,
								},
							]
						: [],
				),
			})
			// Scroll only the editor; CodeMirror's scrollIntoView would also move the page.
			let line = view.lineBlockAt(Math.min(typingAt, view.state.doc.length))
			view.scrollDOM.scrollTop = line.top - view.scrollDOM.clientHeight / 2
		}
		showTypist()
		return () => cancelAnimationFrame(retry)
	}, [typist, typingAt, frame.content])

	return (
		<div className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&>*]:h-full">
			<MarkdownEditor
				ref={editor}
				value={frame.content}
				onChange={() => {}}
				extensions={editorExtensions}
				readOnly
				typeToFocus={false}
				spellcheck={false}
				autocomplete={false}
			/>
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
