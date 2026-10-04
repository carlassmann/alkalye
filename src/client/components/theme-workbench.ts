import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import type { Replica } from "../../shared/crdt"
import type { Operation } from "../../shared/model"
import type { Markup } from "../language"
import { html } from "../language"
import { PickerElement, pickerMarkup } from "./menu"

import { slides } from "../../shared/markdown"
import { renderDocument, clearDocument } from "./document-renderer"
interface ThemeOptions {
	session: {
		replica: Pick<Replica, "fields" | "text" | "documents">
		changes: Stream.Stream<unknown>
		change(
			label: string,
			build: (staged: Replica) => (Operation | null)[],
		): Effect.Effect<unknown, unknown>
	}
	writable(): boolean
	run(task: Effect.Effect<unknown, unknown>): Promise<unknown>
	report(error: unknown): void
	content: string
	dialog: HTMLDialogElement
	showDialog(title: string, body: string | Markup): void
	download(filename: string, content: string | Blob, type: string): void
	assets(source: string): Map<string, string>
}
let sample = `# Theme workbench

A theme should make every kind of writing feel at home.

## A useful idea

> Clarity comes from the choices you leave out.

- One thought at a time
- A little room to breathe
- [A link](https://alkalye.com)

| Detail | Example |
| --- | --- |
| Emphasis | **Bold** and *italic* |
| Code | \`let idea = "hello"\` |

---

# Another perspective

Two columns are separated by a blank horizontal rule.

***

A second column with a different thought.

???

These notes stay with the speaker.`
export function openThemeWorkbench(id: string, options: ThemeOptions) {
	let { session, dialog, showDialog } = options
	let documents = session.replica.documents("")
	showDialog(
		"Theme workbench",
		html`<alkalye-theme-workbench data-theme-workbench>
			<div class="workbench-controls">
				<label
					>Name<input
						id="theme-name"
						value="${session.replica.fields(id).name ?? "Custom theme"}"
				/></label>
				<label
					>Preview${pickerMarkup(
						"theme-target",
						"Preview",
						[
							{ value: "current", label: "Current document" },
							{ value: "sample", label: "Sample content" },
							...documents.map(doc => ({ value: doc.id, label: doc.title })),
						],
						"current",
					)}</label
				>
				<label
					>Mode${pickerMarkup(
						"theme-mode",
						"Mode",
						[
							{ value: "document", label: "Document" },
							{ value: "slideshow", label: "Slideshow" },
						],
						"document",
					)}</label
				>
				<label
					>Appearance${pickerMarkup(
						"theme-appearance",
						"Appearance",
						[
							{ value: "light", label: "Light" },
							{ value: "dark", label: "Dark" },
						],
						"light",
					)}</label
				>
				<label
					>Layout${pickerMarkup(
						"theme-layout",
						"Layout",
						[
							{ value: "split", label: "Split" },
							{ value: "source", label: "Source" },
							{ value: "preview", label: "Preview" },
						],
						"split",
					)}</label
				>
				<label
					>Split<input
						id="theme-split"
						type="range"
						min="20"
						max="80"
						value="50"
				/></label>
			</div>
			<div class="workbench" data-layout="split">
				<textarea
					id="theme-source"
					aria-label="Theme source"
					spellcheck="false"
				>
${session.replica.text(id)}</textarea>
				<div id="theme-preview"></div>
			</div>
			<p id="theme-error" role="status"></p>
			<div class="button-row">
				<button type="button" id="export-theme">Export theme</button>
				<button type="button" id="theme-previous">Previous slide</button
				><output id="theme-slide">1</output
				><button type="button" id="theme-next">Next slide</button>
			</div>
		</alkalye-theme-workbench>`,
	)
	let component = dialog.querySelector("alkalye-theme-workbench")
	if (!(component instanceof ThemeWorkbenchElement))
		throw new Error("Theme workbench missing")
	component.configure(id, options)
}

export class ThemeWorkbenchElement extends HTMLElement {
	private configured: { id: string; options: ThemeOptions } | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(id: string, options: ThemeOptions) {
		this.configured = { id, options }
		if (this.isConnected) this.connectedCallback()
	}
	connectedCallback() {
		let configuration = this.configured
		if (!configuration || this.lifetime) return
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let view = yield* Effect.acquireRelease(
						Effect.sync(() =>
							createThemeWorkbench(configuration.id, configuration.options),
						),
						view => Effect.sync(view.dispose),
					)
					yield* configuration.options.session.changes.pipe(
						Stream.runForEach(() => Effect.sync(view.preview)),
						Effect.forkScoped({ startImmediately: true }),
					)
					yield* Stream.fromEventListener(
						configuration.options.dialog,
						"close",
					).pipe(
						Stream.filter(() => !configuration.options.dialog.open),
						Stream.take(1),
						Stream.runDrain,
					)
				}),
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

function createThemeWorkbench(id: string, options: ThemeOptions) {
	let { session, dialog, download, assets } = options
	let root = dialog.querySelector("alkalye-theme-workbench")
	if (!(root instanceof HTMLElement)) throw new Error("Theme workbench missing")
	function element(selector: string) {
		let candidate = root?.querySelector(selector)
		if (!(candidate instanceof HTMLElement))
			throw new Error("Theme control missing: " + selector)
		return candidate
	}
	function select(name: string) {
		let control = root?.querySelector(`alkalye-picker[name="${name}"]`)
		if (!(control instanceof PickerElement))
			throw new Error("Theme control missing: " + name)
		return control
	}
	function write(
		label: string,
		build: (staged: Replica) => (Operation | null)[],
	) {
		if (!options.writable()) return
		void options
			.run(
				session.change(label, staged => {
					if (!options.writable()) throw new Error("This document is read-only")
					return build(staged)
				}),
			)
			.catch(options.report)
	}
	dialog.classList.add("wide")
	let events = new AbortController()
	dialog.addEventListener(
		"close",
		() => {
			if (dialog.open) return
			let current = dialog.querySelector(
				"alkalye-whiteboard, alkalye-theme-workbench",
			)
			if (!current || current === root) dialog.classList.remove("wide")
			events.abort()
		},
		{ once: true, signal: events.signal },
	)
	let source = dialog.querySelector("#theme-source"),
		title = dialog.querySelector("#theme-name")
	if (
		!(source instanceof HTMLTextAreaElement) ||
		!(title instanceof HTMLInputElement)
	)
		throw new Error("Theme controls missing")
	source.readOnly = !options.writable()
	title.disabled = !options.writable()
	let editor = source,
		name = title,
		slideIndex = 0
	let mode = select("theme-mode"),
		target = select("theme-target"),
		appearance = select("theme-appearance"),
		layout = select("theme-layout")
	function content() {
		return target.value === "sample"
			? sample
			: target.value === "current"
				? options.content
				: session.replica.text(target.value)
	}
	function preview() {
		editor.readOnly = !options.writable()
		name.disabled = !options.writable()
		let source = content(),
			pages = slides(source)
		slideIndex = Math.max(0, Math.min(slideIndex, pages.length - 1))
		try {
			renderDocument(
				element("#theme-preview"),
				mode.value === "slideshow"
					? (pages[slideIndex]?.content ?? "")
					: source,
				{
					theme: editor.value,
					mode: mode.value,
					appearance: appearance.value,
					slideNumber: slideIndex + 1,
					assets: assets(source),
				},
			)
			element("#theme-error").textContent = ""
		} catch (error) {
			element("#theme-error").textContent =
				error instanceof Error ? error.message : "Invalid theme"
		}
		element("#theme-slide").textContent = `${slideIndex + 1} / ${pages.length}`
	}
	editor.oninput = () => {
		if (!options.writable()) return
		preview()
		let content = editor.value
		write("Edit theme", staged => [staged.edit(id, content)])
	}
	name.onchange = () => {
		let value = name.value
		write("Rename theme", staged => [staged.set(id, "name", value)])
	}

	for (let control of [mode, target, appearance]) control.onchange = preview
	layout.onchange = () => {
		let workbench = dialog.querySelector<HTMLElement>(".workbench")
		if (workbench) workbench.dataset.layout = layout.value
	}
	let split = dialog.querySelector<HTMLInputElement>("#theme-split")
	if (split)
		split.oninput = () => {
			dialog
				.querySelector<HTMLElement>(".workbench")
				?.style.setProperty("--split", split.value + "%")
		}
	element("#export-theme").onclick = () =>
		download(`${name.value}.theme.md`, editor.value, "text/markdown")
	element("#theme-previous").onclick = () => {
		slideIndex--
		preview()
	}
	element("#theme-next").onclick = () => {
		slideIndex++
		preview()
	}
	preview()
	return {
		preview,
		dispose() {
			events.abort()
			let current = dialog.querySelector(
				"alkalye-whiteboard, alkalye-theme-workbench",
			)
			if (!current || current === root) dialog.classList.remove("wide")
			clearDocument(element("#theme-preview"))
			for (let node of root.querySelectorAll<HTMLElement>("*")) {
				node.onclick = null
				node.oninput = null
				node.onchange = null
			}
		},
	}
}
