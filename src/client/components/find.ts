import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { element, setMarkup } from "../dom"
import { icon } from "../icons"
import { html } from "../language"
import { toast } from "./toast"
import { replaceSelectedMatch } from "../../shared/find"
import type { SourceTextarea } from "../source-textarea"
import { EditorElement } from "./editor"

// Without a scope, find searches the open document from the app's find bar.
export function openFind(
	query = "",
	replace = false,
	scope?: { editor: EditorElement; bar: HTMLElement },
) {
	let host = scope?.editor ?? document.querySelector("alkalye-editor")
	if (!(host instanceof EditorElement) || !host.source) return
	let source = host.source
	let bar = scope?.bar ?? element("#find-bar")
	let app = document.querySelector("#app")
	if (!scope && app && bar.parentElement !== app) app.append(bar)
	bar.hidden = false
	let existing = bar.querySelector("alkalye-find")
	if (existing instanceof FindElement) {
		existing.showReplacement(replace)
		return existing.focusSearch(query)
	}
	let component = new FindElement()
	component.configure(
		host,
		() => {
			bar.hidden = true
			component.remove()
			source.focus()
		},
		query,
	)
	bar.replaceChildren(component)
	component.showReplacement(replace)
}

export class FindElement extends HTMLElement {
	private host: EditorElement | undefined
	private editor: SourceTextarea | undefined
	private close: () => void = () => {}
	private query = ""
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(host: EditorElement, close: () => void, query = "") {
		this.host = host
		this.editor = host.source
		this.close = close
		this.query = query
	}
	focusSearch(query = "") {
		let input = this.querySelector<HTMLInputElement>("#find-text")
		if (input && query) input.value = query
		input?.select()
		this.refreshCount()
	}
	connectedCallback() {
		let configured = this.editor
		if (!configured || this.lifetime) return
		let editor = configured
		let host = this
		this.dataset.find = ""
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let events = yield* Effect.acquireRelease(
						Effect.sync(() => new AbortController()),
						controller => Effect.sync(() => controller.abort()),
					)
					setMarkup(
						host,
						html`<div class="find-query-row">
								<input
									id="find-text"
									type="text"
									placeholder="Find in document"
									aria-label="Find in document"
								/>
								<button
									type="button"
									data-find-action="toggle-replace"
									aria-label="Toggle replace"
									title="Find and replace"
								>
									${icon("chevron-down")}
								</button>
								<button
									type="button"
									data-find-action="close"
									id="close-find"
									aria-label="Close find"
									title="Close find (Esc)"
								>
									${icon("x")}
								</button>
							</div>
							<div class="find-replace-row" hidden>
								<input
									id="replace-text"
									type="text"
									placeholder="Replace with…"
									aria-label="Replace with"
								/>
								<button
									type="button"
									data-find-action="replace"
									id="replace-one"
								>
									Replace
								</button>
								<button
									type="button"
									data-find-action="replace-all"
									id="replace-all"
								>
									Replace all
								</button>
							</div>
							<div class="find-controls">
								<label class="find-toggle" title="Match case"
									><input
										id="find-case"
										type="checkbox"
										aria-label="Match case"
									/><span>Aa</span></label
								>
								<label class="find-toggle" title="Regular expression"
									><input
										id="find-regex"
										type="checkbox"
										aria-label="Regular expression"
									/><span>.*</span></label
								>
								<output class="find-count" aria-live="polite"></output>
								<button
									type="button"
									data-find-action="previous"
									id="find-previous"
									aria-label="Previous match"
									title="Previous match (⇧Enter)"
								>
									${icon("chevron-up")}
								</button>
								<button
									type="button"
									data-find-action="next"
									id="find-next"
									aria-label="Next match"
									title="Next match (Enter)"
								>
									${icon("chevron-down")}
								</button>
							</div>`,
					)
					host.addEventListener(
						"click",
						event => {
							if (!(event.target instanceof Element)) return
							let action =
								event.target.closest<HTMLElement>("[data-find-action]")?.dataset
									.findAction
							if (action) host.perform(action)
						},
						{ signal: events.signal },
					)
					host.addEventListener("input", () => host.refreshCount(), {
						signal: events.signal,
					})
					editor.element.addEventListener("select", () => host.refreshCount(), {
						signal: events.signal,
					})
					document.addEventListener(
						"keydown",
						event => {
							if (
								event.key === "Escape" &&
								!event.defaultPrevented &&
								!document.querySelector("dialog[open]")
							) {
								event.preventDefault()
								host.close()
							}
						},
						{ signal: events.signal },
					)
					host.addEventListener(
						"keydown",
						event => {
							if (event.isComposing) return
							if (event.key === "Escape") {
								event.preventDefault()
								host.close()
							} else if (event.key === "Enter") {
								event.preventDefault()
								host.perform(
									event.target instanceof HTMLInputElement &&
										event.target.id === "replace-text"
										? "replace"
										: event.shiftKey
											? "previous"
											: "next",
								)
							}
						},
						{ signal: events.signal },
					)
					let refresh = () => {
						for (let button of host.querySelectorAll<HTMLButtonElement>(
							"#replace-one, #replace-all",
						))
							button.disabled = editor.readOnly
					}
					let observer = yield* Effect.acquireRelease(
						Effect.sync(() => new MutationObserver(refresh)),
						observer => Effect.sync(() => observer.disconnect()),
					)
					observer.observe(editor.element, {
						attributes: true,
						attributeFilter: ["readonly"],
					})
					refresh()
					host.focusSearch(host.query)
					return yield* Effect.never
				}),
			),
		)
	}
	perform(action: string) {
		let editor = this.editor
		if (!editor || !this.isConnected) return
		if (action === "close") return this.close()
		if (action === "toggle-replace")
			return this.showReplacement(
				this.querySelector(".find-replace-row")?.hasAttribute("hidden") ??
					false,
			)
		let pattern = this.expression()
		if (!pattern) return
		if (action === "next" || action === "previous") {
			let matches = [...editor.value.matchAll(pattern)]
			let match =
				action === "next"
					? (matches.find(
							match =>
								match.index >= editor.selectionEnd &&
								(match[0].length > 0 || match.index > editor.selectionEnd),
						) ?? matches[0])
					: (matches
							.filter(match => match.index < editor.selectionStart)
							.at(-1) ?? matches.at(-1))
			if (!match) return toast("No match")
			if (this.host)
				this.host.selectRange(match.index, match.index + match[0].length)
			else editor.setSelectionRange(match.index, match.index + match[0].length)
			editor.dispatchEvent(new Event("select"))
			this.querySelector<HTMLInputElement>("#find-text")?.focus({
				preventScroll: true,
			})
			return
		}
		if (editor.readOnly) return
		let replacement = this.querySelector<HTMLInputElement>("#replace-text")
		if (!replacement) return
		if (action === "replace-all")
			editor.value = editor.value.replace(pattern, replacement.value)
		else if (action === "replace") {
			let changed = replaceSelectedMatch(
				editor.value,
				pattern,
				replacement.value,
				editor.selectionStart,
				editor.selectionEnd,
			)
			if (changed === undefined) return
			editor.setRangeText(
				changed,
				editor.selectionStart,
				editor.selectionEnd,
				"end",
			)
		} else return
		editor.dispatchEvent(new Event("input"))
		this.refreshCount()
	}
	showReplacement(show: boolean) {
		let row = this.querySelector<HTMLElement>(".find-replace-row")
		if (row) row.hidden = !show
		this.toggleAttribute("data-replace", show)
		this.querySelector('[data-find-action="toggle-replace"]')?.setAttribute(
			"aria-expanded",
			String(show),
		)
	}
	private refreshCount() {
		let count = this.querySelector(".find-count")
		if (!count || !this.editor) return
		let pattern = this.expression(false)
		let matches = pattern ? [...this.editor.value.matchAll(pattern)] : []
		let current = matches.findIndex(
			match => match.index === this.editor?.selectionStart,
		)
		count.textContent = pattern
			? matches.length
				? `${Math.max(0, current + 1)} of ${matches.length}`
				: "No results"
			: ""
		count.toggleAttribute("data-empty", Boolean(pattern && !matches.length))
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		this.lifetime = undefined
		if (lifetime) Effect.runFork(Fiber.interrupt(lifetime))
	}
	connectedMoveCallback() {}
	private expression(report = true) {
		let input = this.querySelector<HTMLInputElement>("#find-text")
		if (!input?.value) return
		let regex = this.querySelector<HTMLInputElement>("#find-regex")?.checked
		let sensitive = this.querySelector<HTMLInputElement>("#find-case")?.checked
		try {
			return new RegExp(
				regex
					? input.value
					: input.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
				sensitive ? "gu" : "giu",
			)
		} catch {
			if (report) toast("Invalid regular expression")
		}
	}
}
customElements.define("alkalye-find", FindElement)
