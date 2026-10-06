import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberHandle from "effect/FiberHandle"
import * as FiberSet from "effect/FiberSet"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { frontmatter, slides } from "../../shared/markdown"
import type { Atom, DocumentLink, Operation } from "../../shared/model"
import type { EditorPreferences } from "../../shared/preferences"
import { routeHref } from "../../shared/routes"
import type { AppRoute } from "../../shared/routes"
import { lineRange, themeSourceProblems } from "../../shared/theme-source"
import type { ThemeSourceProblem } from "../../shared/theme-source"
import { setMarkup } from "../dom"
import { shortcutAction } from "../shortcuts"
import { icon } from "../icons"
import type { IconName } from "../icons"
import { html, joinMarkup, rawMarkup, translate } from "../language"
import { clearDocument, renderDocument } from "./document-renderer"
import { mountEditor } from "./editor"
import { openFind } from "./find"
import { PickerElement, pickerMarkup } from "./menu"

// A theme's source text inside the document that stores it: the account's
// theme library or the document the theme is attached to.
export interface ThemeSource {
	readonly library: boolean
	readonly owner: string
	name(): string
	available(): boolean
	text(): string
	lastValid(): string
	rememberValid(content: string): Effect.Effect<void, unknown>
	atoms(): Atom[]
	writable(): boolean
	edit(
		content: string,
		base?: Atom[],
	):
		| {
				atoms: Atom[]
				operation: Operation | null
				saved: Effect.Effect<void, unknown>
		  }
		| undefined
	undo(redo: boolean): Effect.Effect<unknown, unknown>
	pending(): boolean
	readonly flush: Effect.Effect<void, unknown>
	readonly changes: Stream.Stream<unknown>
	download(): void
}
// A document whose content previews the theme.
export interface PreviewDocument {
	text(): string
	assets(): Map<string, string>
	readonly changes: Stream.Stream<unknown>
}
export type WorkbenchRoute = Extract<AppRoute, { kind: "themeWorkbench" }>
export interface ThemeWorkbenchOptions {
	readonly route: WorkbenchRoute
	readonly open: Effect.Effect<ThemeSource | undefined, unknown, Scope.Scope>
	targets(): readonly DocumentLink[]
	readonly targetChanges: Stream.Stream<unknown>
	openTarget(id: string): Effect.Effect<PreviewDocument, unknown, Scope.Scope>
	preferences(): EditorPreferences
	openDocument(id: string): void
	readonly createFromDefault: Effect.Effect<unknown, unknown>
	report(error: unknown): void
}

type Layout = "split" | "source" | "preview"
type Pane = "source" | "preview"
type PreviewMode = "document" | "slideshow"
type Appearance = "light" | "dark"
interface WorkbenchState {
	layout: Layout
	// The source pane's share of the split, in percent.
	split: number
	mode: PreviewMode
	appearance: Appearance
	target: string
	slide: number
	resizing: boolean
	creating: boolean
	saveError: string
	// The last source that compiled, which the preview keeps while invalid.
	valid: string
}

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
let presentationSampleContent = `---
mode: present
---

# Theme workbench

Design the opening moment.

---

## A second slide

- hierarchy
- spacing
- contrast
`

// The original's full-viewport workbench: theme source beside a live
// preview of sample content or any document, in either appearance. Its
// source view shows the same editor without the preview.
export class ThemeWorkbenchElement extends HTMLElement {
	private options: ThemeWorkbenchOptions | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(options: ThemeWorkbenchOptions) {
		this.options = options
		if (this.isConnected) this.connectedCallback()
	}
	connectedCallback() {
		this.dataset.themeWorkbench = ""
		let options = this.options
		if (!options || this.lifetime) return
		this.dataset.view = options.route.view ?? "workbench"
		let host = this
		this.lifetime = Effect.runFork(
			Effect.scoped(runWorkbench(host, options)).pipe(
				Effect.catch(error => Effect.sync(() => options.report(error))),
			),
		)
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		this.lifetime = undefined
		if (lifetime) Effect.runFork(Fiber.interrupt(lifetime))
	}
	connectedMoveCallback() {}
}
customElements.define("alkalye-theme-workbench", ThemeWorkbenchElement)

function runWorkbench(host: HTMLElement, options: ThemeWorkbenchOptions) {
	return Effect.gen(function* () {
		setMarkup(host, emptyMarkup(translate("Loading theme…")))
		let source = yield* options.open
		if (!source?.available()) {
			setMarkup(host, unavailableMarkup())
			return
		}
		let theme = source
		let sourceView = options.route.view === "source"
		// Edits still queued when the workbench closes are saved before the
		// document is released.
		yield* Effect.addFinalizer(() =>
			theme.flush.pipe(
				Effect.catch(error => Effect.sync(() => options.report(error))),
			),
		)
		let run = yield* FiberSet.makeRuntime<never>()
		// One preview target loads at a time; choosing another interrupts it.
		let loadTarget = yield* FiberHandle.makeRuntime<never, never, void>()
		let events = yield* Effect.acquireRelease(
			Effect.sync(() => new AbortController()),
			events => Effect.sync(() => events.abort()),
		)
		let desktop = matchMedia("(min-width: 1024px)")
		let state: WorkbenchState = {
			layout: sourceView ? "source" : "split",
			split: 50,
			mode: "document",
			appearance: "light",
			target: theme.library ? "sample" : theme.owner,
			slide: 0,
			resizing: false,
			creating: false,
			saveError: "",
			valid: theme.lastValid(),
		}
		let target: PreviewDocument | undefined
		let targetError = ""
		setMarkup(
			host,
			workbenchMarkup(
				theme,
				viewHref(sourceView ? "workbench" : "source"),
				sourceView,
				targetChoices(),
				state.target,
			),
		)
		let panes = part(".workbench-panes", HTMLElement)
		let separator = part('[role="separator"]', HTMLElement)
		let preview = part("#theme-preview", HTMLElement)
		let frame = part(".workbench-preview", HTMLElement)
		let findBar = part("[data-workbench-find]", HTMLElement)
		let picker = part('alkalye-picker[name="theme-target"]', PickerElement)
		let editor = mountEditor(part(".workbench-editor", HTMLElement), {
			content: theme.text(),
			atoms: theme.atoms(),
			editable: theme.writable(),
			preferences: options.preferences(),
			documents: options.targets,
			openDocument: id => options.openDocument(id),
			isDrawing: () => false,
			openDrawing: () => {},
			createLinkedDocument: () =>
				Promise.reject(new Error("Theme sources cannot create documents")),
			comments: () => [],
			canComment: () => false,
			canAttach: () => false,
			change: (content, base) => {
				if (!theme.writable()) {
					refreshSource()
					return
				}
				let edit = theme.edit(content, base)
				if (!edit) return
				run(
					edit.saved.pipe(
						Effect.match({
							onFailure: error => {
								state.saveError =
									error instanceof Error
										? error.message
										: translate("Theme source could not be saved.")
							},
							onSuccess: () => {
								state.saveError = ""
							},
						}),
						Effect.ensuring(Effect.sync(refreshStatus)),
					),
				)
				refreshStatus()
				refreshHeader()
				renderPreview()
				return edit
			},
			undo: redo => {
				if (theme.writable())
					run(
						theme
							.undo(redo)
							.pipe(
								Effect.catch(error => Effect.sync(() => options.report(error))),
							),
					)
			},
			select: () => {},
			requestAsset: () => {},
			attach: () => {},
			command: () => {},
			find: query => findInSource(query),
			report: options.report,
		})
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				editor.remove()
				clearDocument(preview)
			}),
		)
		let textarea = editor.querySelector("textarea")
		textarea?.setAttribute("aria-label", translate("Theme source"))
		if (textarea) textarea.placeholder = translate("Write theme source")

		host.addEventListener("click", click, { signal: events.signal })
		document.addEventListener("keydown", findByShortcut, {
			signal: events.signal,
		})
		separator.addEventListener("pointerdown", startResize, {
			signal: events.signal,
		})
		separator.addEventListener("pointermove", resize, {
			signal: events.signal,
		})
		for (let type of ["pointerup", "pointercancel"])
			separator.addEventListener(type, stopResize, { signal: events.signal })
		separator.addEventListener("keydown", resizeByKey, {
			signal: events.signal,
		})
		desktop.addEventListener("change", refreshLayout, {
			signal: events.signal,
		})
		document.addEventListener("keydown", navigateSlides, {
			signal: events.signal,
		})
		picker.addEventListener(
			"change",
			() => {
				state.target = picker.value
				state.slide = 0
				showTarget()
			},
			{ signal: events.signal },
		)

		refreshLayout()
		refreshSource()
		if (!sourceView) showTarget()
		yield* options.targetChanges.pipe(
			Stream.runForEach(() => Effect.sync(refreshTargets)),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* theme.changes.pipe(
			Stream.runForEach(() => Effect.sync(refreshSource)),
		)

		function part<T extends Element>(selector: string, type: new () => T) {
			let found = host.querySelector(selector)
			if (!(found instanceof type))
				throw new Error("Theme workbench part missing: " + selector)
			return found
		}
		function viewHref(view: "workbench" | "source") {
			return routeHref({
				kind: "themeWorkbench",
				theme: options.route.theme,
				...(theme.library ? {} : { document: theme.owner }),
				...(view === "source" ? { view } : {}),
			})
		}
		// A deleted theme may return through undo or sync, so the workbench
		// stays mounted and read-only until it does.
		function refreshSource() {
			let available = theme.available()
			host.dataset.state = available ? "ready" : "unavailable"
			panes.hidden = !available
			part(".workbench-unavailable", HTMLElement).hidden = available
			editor.update(theme.text(), theme.atoms(), theme.writable())
			refreshHeader()
			refreshStatus()
			if (available) renderPreview()
		}
		function refreshHeader() {
			part(".workbench-name", HTMLElement).textContent = theme.name()
		}
		function refreshStatus() {
			part(".workbench-status", HTMLElement).textContent = translate(
				!theme.writable()
					? "Read-only"
					: theme.pending()
						? "Saving locally…"
						: "Saved locally",
			)
			let failure = part(".workbench-save-error", HTMLElement)
			failure.hidden = !state.saveError
			failure.textContent = state.saveError
			part(
				'[data-workbench-action="new-default"]',
				HTMLButtonElement,
			).disabled = state.creating
		}
		function targetChoices() {
			return [
				{ value: "sample", label: translate("Sample content") },
				...options.targets().map(document => ({
					value: document.id,
					label: document.title || translate("Untitled document"),
				})),
			]
		}
		function refreshTargets() {
			let choices = targetChoices()
			let removed = !choices.some(choice => choice.value === state.target)
			if (removed) state.target = "sample"
			picker.setChoices(choices, state.target)
			if (removed && !sourceView) showTarget()
		}
		function showTarget() {
			let id = state.target
			target = undefined
			targetError = ""
			renderPreview()
			if (id === "sample") {
				loadTarget(Effect.void)
				return
			}
			loadTarget(
				Effect.scoped(
					Effect.gen(function* () {
						let opened = yield* options.openTarget(id)
						if (state.target !== id) return
						target = opened
						renderPreview()
						yield* opened.changes.pipe(
							Stream.runForEach(() =>
								Effect.sync(() => {
									if (state.target === id) renderPreview()
								}),
							),
						)
					}),
				).pipe(
					Effect.catch(error =>
						Effect.sync(() => {
							if (state.target !== id) return
							targetError =
								error instanceof Error
									? error.message
									: translate("This document could not be opened")
							renderPreview()
						}),
					),
				),
			)
		}
		function targetContent() {
			if (state.target === "sample")
				return state.mode === "slideshow"
					? presentationSampleContent
					: sampleContent
			return target?.text() ?? ""
		}
		function renderPreview() {
			let source = theme.text()
			let problems = themeSourceProblems(source)
			if (!problems.length && source !== state.valid) {
				state.valid = source
				run(theme.rememberValid(source).pipe(Effect.ignore))
			}
			showProblems(problems)
			if (sourceView) return
			frame.dataset.appearance = state.appearance
			frame.dataset.mode = state.mode
			let message = part(".workbench-preview-message", HTMLElement)
			let loading = state.target !== "sample" && !target
			message.hidden = !loading
			message.textContent = targetError || translate("Loading document…")
			preview.hidden = loading
			if (loading) return
			let content = targetContent()
			let pages = slides(content)
			state.slide = Math.max(0, Math.min(state.slide, pages.length - 1))
			let header = frontmatter(content).values
			renderDocument(
				preview,
				state.mode === "slideshow"
					? (pages[state.slide]?.content ?? "")
					: content,
				{
					theme: state.valid,
					mode: state.mode,
					appearance: state.appearance,
					size: header.size,
					preset: header.preset,
					syntaxTheme: options.preferences().syntaxTheme,
					slideNumber: state.slide + 1,
					assets: target?.assets() ?? new Map(),
					resolve: id =>
						options.targets().find(document => document.id === id)?.title ||
						translate("Untitled document"),
				},
			)
			refreshSlideControls(pages.length)
		}
		function showProblems(problems: ThemeSourceProblem[]) {
			let list = part(".workbench-errors", HTMLElement)
			list.hidden = !problems.length
			let key = JSON.stringify(problems)
			if (list.dataset.problems === key) return
			list.dataset.problems = key
			setMarkup(
				list,
				joinMarkup(
					problems.map(
						problem =>
							html`<button
								type="button"
								data-workbench-action="jump"
								data-line="${problem.line}"
							>
								${icon("circle-alert")}<span
									>${translate("Line {number}").replace(
										"{number}",
										String(problem.line),
									)}:
									${problem.message}.
									${translate("Preview keeps the last valid theme.")}</span
								>
							</button>`,
					),
				),
			)
		}
		function refreshSlideControls(count: number) {
			part(".workbench-slide-options", HTMLElement).hidden =
				state.mode !== "slideshow"
			part(
				'[data-workbench-action="previous-slide"]',
				HTMLButtonElement,
			).disabled = state.slide <= 0
			part('[data-workbench-action="next-slide"]', HTMLButtonElement).disabled =
				state.slide >= count - 1
		}
		function refreshLayout() {
			let vertical = desktop.matches
			panes.dataset.layout = state.layout
			panes.dataset.orientation = vertical ? "row" : "column"
			for (let pane of bothPanes) {
				let section = part(`[data-pane="${pane}"]`, HTMLElement)
				section.hidden = state.layout === other(pane)
				section.style.flexGrow = String(
					state.layout === "split"
						? pane === "source"
							? state.split
							: 100 - state.split
						: 1,
				)
				setMarkup(
					part(`[data-layout-controls="${pane}"]`, HTMLElement),
					sourceView ? "" : layoutControls(pane, state.layout),
				)
				part(`[data-restore="${pane}"]`, HTMLElement).hidden =
					sourceView || state.layout !== other(pane)
			}
			separator.hidden = state.layout !== "split"
			separator.setAttribute(
				"aria-orientation",
				vertical ? "vertical" : "horizontal",
			)
			separator.setAttribute("aria-valuenow", String(Math.round(state.split)))
			separator.setAttribute(
				"aria-valuetext",
				`${translate("Source pane")} ${Math.round(state.split)}%`,
			)
		}
		function setLayout(layout: Layout) {
			if (sourceView) return
			state.layout = layout
			refreshLayout()
		}
		function setSplit(value: number) {
			state.split = Math.min(75, Math.max(25, value))
			refreshLayout()
		}
		function startResize(event: PointerEvent) {
			event.preventDefault()
			state.resizing = true
			separator.setPointerCapture(event.pointerId)
			resizeTo(event)
		}
		function resize(event: PointerEvent) {
			if (!state.resizing) return
			event.preventDefault()
			resizeTo(event)
		}
		function stopResize(event: Event) {
			state.resizing = false
			if (
				event instanceof PointerEvent &&
				separator.hasPointerCapture(event.pointerId)
			)
				separator.releasePointerCapture(event.pointerId)
		}
		function resizeTo(event: PointerEvent) {
			let bounds = panes.getBoundingClientRect()
			let length = desktop.matches ? bounds.width : bounds.height
			if (!length) return
			let position = desktop.matches
				? event.clientX - bounds.left
				: event.clientY - bounds.top
			setSplit((position / length) * 100)
		}
		function resizeByKey(event: KeyboardEvent) {
			let step =
				event.key === (desktop.matches ? "ArrowLeft" : "ArrowUp")
					? -5
					: event.key === (desktop.matches ? "ArrowRight" : "ArrowDown")
						? 5
						: 0
			if (event.key === "Home") setSplit(25)
			else if (event.key === "End") setSplit(75)
			else if (step) setSplit(state.split + step)
			else return
			event.preventDefault()
			event.stopPropagation()
		}
		function navigateSlides(event: KeyboardEvent) {
			if (
				event.defaultPrevented ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				document.querySelector(
					'dialog[open], [role="menu"]:popover-open, [role="listbox"]:popover-open',
				) ||
				sourceView ||
				!theme.available() ||
				state.mode !== "slideshow" ||
				state.layout === "source" ||
				(event.target instanceof HTMLElement &&
					(event.target.isContentEditable ||
						event.target.closest("input, textarea, select, [role=separator]")))
			)
				return
			if (event.key === "ArrowLeft") changeSlide(-1)
			else if (event.key === "ArrowRight" || event.key === " ") changeSlide(1)
			else if (event.key === "f" || event.key === "F") toggleFullscreen()
			else return
			event.preventDefault()
		}
		// The app's own find shortcuts are off while a page covers it, so the
		// source finds here instead of in the document underneath.
		function findByShortcut(event: KeyboardEvent) {
			if (!theme.available()) return
			let action = shortcutAction(event)
			if (action === "find") {
				event.preventDefault()
				findInSource("", event.key.toLowerCase() === "h")
			} else if (action === "find-next" || action === "find-previous") {
				event.preventDefault()
				let button = findBar.querySelector("#" + action)
				if (button instanceof HTMLButtonElement) button.click()
				else findInSource()
			}
		}
		function findInSource(query = "", replace = false) {
			openFind(query, replace, { editor, bar: findBar })
		}
		function changeSlide(step: number) {
			state.slide += step
			renderPreview()
		}
		function toggleFullscreen() {
			if (document.fullscreenElement) void document.exitFullscreen()
			else
				void document.documentElement.requestFullscreen().catch(options.report)
		}
		function jumpToLine(line: number) {
			let text = editor.source?.value ?? theme.text()
			let range = lineRange(text, line)
			editor.selectRange(range.start, range.end)
		}
		function click(event: Event) {
			if (!(event.target instanceof Element)) return
			if (
				event.target.closest(".workbench-preview") &&
				!event.target.closest("button, a, alkalye-menu") &&
				state.mode === "slideshow"
			)
				return changeSlide(1)
			let control = event.target.closest("[data-workbench-action]")
			if (
				!(control instanceof HTMLElement) ||
				(control instanceof HTMLButtonElement && control.disabled)
			)
				return
			let action = control.dataset.workbenchAction
			if (action === "layout")
				setLayout(
					control.dataset.layout === "source" ||
						control.dataset.layout === "preview"
						? control.dataset.layout
						: "split",
				)
			else if (action === "mode") {
				state.mode =
					control.dataset.mode === "slideshow" ? "slideshow" : "document"
				state.slide = 0
				pressed("mode", state.mode)
				renderPreview()
			} else if (action === "appearance") {
				state.appearance =
					control.dataset.appearance === "dark" ? "dark" : "light"
				pressed("appearance", state.appearance)
				renderPreview()
			} else if (action === "jump") jumpToLine(Number(control.dataset.line))
			else if (action === "previous-slide") changeSlide(-1)
			else if (action === "next-slide") changeSlide(1)
			else if (action === "fullscreen") toggleFullscreen()
			else if (action === "export") theme.download()
			else if (action === "new-default") {
				state.creating = true
				refreshStatus()
				run(
					options.createFromDefault.pipe(
						Effect.catch(error => Effect.sync(() => options.report(error))),
						Effect.ensuring(
							Effect.sync(() => {
								state.creating = false
								if (host.isConnected) refreshStatus()
							}),
						),
					),
				)
			}
		}
		function pressed(action: string, value: string) {
			for (let button of host.querySelectorAll(
				`[data-workbench-action="${action}"]`,
			))
				if (button instanceof HTMLElement)
					button.setAttribute(
						"aria-pressed",
						String(button.dataset[action] === value),
					)
		}
	})
}

let bothPanes: readonly Pane[] = ["source", "preview"]
function other(pane: Pane): Pane {
	return pane === "source" ? "preview" : "source"
}

function workbenchMarkup(
	theme: ThemeSource,
	switchHref: string,
	sourceView: boolean,
	targets: { value: string; label: string }[],
	target: string,
) {
	let back = theme.library
		? {
				href: routeHref({ kind: "settings", category: "editor" }),
				label: translate("Back to settings"),
			}
		: {
				href: routeHref({
					kind: "document",
					document: theme.owner,
					mode: "edit",
				}),
				label: translate("Back to document"),
			}
	return html`<header class="workbench-header">
			<a
				class="workbench-back"
				href="${back.href}"
				aria-label="${back.label}"
				title="${back.label}"
				>${icon("arrow-left")}</a
			>
			<div class="workbench-title">
				<h1 class="workbench-name" tabindex="-1"></h1>
				<p>${translate(sourceView ? "Theme source" : "Theme workbench")}</p>
			</div>
			<button
				type="button"
				class="outline"
				data-workbench-action="new-default"
				${sourceView ? "hidden" : ""}
			>
				New from default</button
			>${
				sourceView
					? html`<a
							class="button outline"
							data-workbench-link="workbench"
							href="${switchHref}"
							>${icon("monitor-play")}<span>Open workbench</span></a
						>`
					: html`<a
							class="button outline"
							data-workbench-link="source"
							href="${switchHref}"
							>${icon("external-link")}<span>Open source</span></a
						>`
			}
		</header>
		<div class="workbench-unavailable workbench-empty" hidden>
			<h1 tabindex="-1">Theme unavailable</h1>
			<p>This theme is unavailable or you no longer have access to it.</p>
		</div>
		<div class="workbench-panes">
			<section class="workbench-pane" data-pane="source">
				<div class="workbench-bar">
					<div class="workbench-label">${icon("file-text")}Source</div>
					<div class="workbench-tools">
						<span class="workbench-status" role="status"></span>
						${toolButton(
							'data-workbench-action="export"',
							"Export theme",
							"download",
						)}
						<span data-layout-controls="source"></span>
					</div>
				</div>
				<div class="workbench-find" data-workbench-find hidden></div>
				<div class="workbench-editor"></div>
				<div class="workbench-errors" hidden></div>
				<div class="workbench-save-error" role="alert" hidden></div>
			</section>
			${restoreStrip("source")}
			<div
				role="separator"
				tabindex="0"
				aria-valuemin="25"
				aria-valuemax="75"
				aria-label="Resize source and preview panes"
			></div>
			<section class="workbench-pane" data-pane="preview">
				<div class="workbench-bar workbench-preview-bar">
					${icon("monitor-play")}
					<div class="workbench-label workbench-preview-label">
						Live preview
					</div>
					<div class="workbench-tools">
						<div class="workbench-toggle">
							${toolButton(
								'data-workbench-action="mode" data-mode="document" aria-pressed="true"',
								"Document preview",
								"file-text",
							)}${toolButton(
								'data-workbench-action="mode" data-mode="slideshow" aria-pressed="false"',
								"Slideshow preview",
								"monitor-play",
							)}
						</div>
						<div class="workbench-toggle">
							${toolButton(
								'data-workbench-action="appearance" data-appearance="light" aria-pressed="true"',
								"Light preview",
								"sun",
							)}${toolButton(
								'data-workbench-action="appearance" data-appearance="dark" aria-pressed="false"',
								"Dark preview",
								"moon",
							)}
						</div>
						<span data-layout-controls="preview"></span>
					</div>
					<div class="workbench-target">
						${pickerMarkup("theme-target", "Preview target", targets, target)}
					</div>
				</div>
				<div class="workbench-preview">
					<p class="workbench-preview-message" role="status" hidden></p>
					<div id="theme-preview"></div>
					${slideOptionsMarkup()}
				</div>
			</section>
			${restoreStrip("preview")}
		</div>`
}

function slideOptionsMarkup() {
	let label = translate("Slideshow options")
	return html`<alkalye-menu
		class="workbench-slide-options"
		side="top"
		align="end"
		hidden
	>
		<button type="button" aria-label="${label}" title="${label}">
			${icon("ellipsis")}
		</button>
		<div class="menu-popover" popover role="menu" aria-label="${label}">
			<button type="button" data-workbench-action="previous-slide">
				<span>Previous slide</span><kbd>←</kbd></button
			><button type="button" data-workbench-action="next-slide">
				<span>Next slide</span><kbd>→</kbd>
			</button>
			<hr />
			<button type="button" data-workbench-action="fullscreen">
				<span>Toggle fullscreen</span><kbd>F</kbd>
			</button>
		</div>
	</alkalye-menu>`
}

function layoutControls(pane: Pane, layout: Layout) {
	if (layout === pane)
		return toolButton(
			'data-workbench-action="layout" data-layout="split"',
			"Restore split view",
			"minimize-2",
		)
	return html`${toolButton(
		`data-workbench-action="layout" data-layout="${other(pane)}"`,
		pane === "source" ? "Minimize source" : "Minimize preview",
		"minimize-2",
	)}${toolButton(
		`data-workbench-action="layout" data-layout="${pane}"`,
		pane === "source" ? "Maximize source" : "Maximize preview",
		"maximize-2",
	)}`
}

function restoreStrip(pane: Pane) {
	return html`<div class="workbench-restore" data-restore="${pane}" hidden>
		${toolButton(
			'data-workbench-action="layout" data-layout="split"',
			pane === "source" ? "Restore source pane" : "Restore preview pane",
			pane === "source" ? "panel-left-open" : "panel-right-open",
		)}
	</div>`
}

function toolButton(attributes: string, label: string, name: IconName) {
	let text = translate(label)
	return html`<button
		type="button"
		class="workbench-icon"
		${rawMarkup(attributes)}
		aria-label="${text}"
		title="${text}"
	>
		${icon(name)}
	</button>`
}

function emptyMarkup(title: string) {
	return html`<div class="workbench-empty">
		<h1 tabindex="-1">${title}</h1>
	</div>`
}

function unavailableMarkup() {
	return html`<div class="workbench-empty">
		<h1 tabindex="-1">Theme unavailable</h1>
		<p>This theme is unavailable or you no longer have access to it.</p>
		<a
			class="button outline"
			href="${routeHref({ kind: "settings", category: "editor" })}"
			>Back to settings</a
		>
	</div>`
}
