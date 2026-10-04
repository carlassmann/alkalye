import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { element, setMarkup } from "../dom"
import { html } from "../language"
import { toast } from "./toast"
import { replaceSelectedMatch } from "../../shared/find"
import type { SourceTextarea } from "../source-textarea"
import { EditorElement } from "./editor"

export function openFind(query = "") {
	let host = document.querySelector("alkalye-editor")
	let editor = host instanceof EditorElement ? host.source : undefined
	if (!editor) return
	let bar = element("#find-bar")
	bar.hidden = false
	let existing = bar.querySelector("alkalye-find")
	if (existing instanceof FindElement) return existing.focusSearch(query)
	let component = new FindElement()
	component.configure(
		editor,
		() => {
			bar.hidden = true
			component.remove()
			editor.focus()
		},
		query,
	)
	bar.replaceChildren(component)
}

export class FindElement extends HTMLElement {
	private editor: SourceTextarea | undefined
	private close: () => void = () => {}
	private query = ""
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(editor: SourceTextarea, close: () => void, query = "") {
		this.editor = editor
		this.close = close
		this.query = query
	}
	focusSearch(query = "") {
		let input = this.querySelector<HTMLInputElement>("#find-text")
		if (input && query) input.value = query
		input?.select()
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
						html`<input
								id="find-text"
								placeholder="Find in document"
								aria-label="Find in document"
							/>
							<input
								id="replace-text"
								placeholder="Replace with"
								aria-label="Replace with"
							/>
							<label><input id="find-case" type="checkbox" /> Match case</label>
							<label><input id="find-regex" type="checkbox" /> Regex</label>
							<button type="button" data-find-action="next" id="find-next">
								Next
							</button>
							<button
								type="button"
								data-find-action="previous"
								id="find-previous"
							>
								Previous
							</button>
							<button type="button" data-find-action="replace" id="replace-one">
								Replace
							</button>
							<button
								type="button"
								data-find-action="replace-all"
								id="replace-all"
							>
								Replace all
							</button>
							<button
								type="button"
								data-find-action="close"
								id="close-find"
								aria-label="Close find"
							>
								×
							</button>`,
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
					host.addEventListener(
						"keydown",
						event => {
							if (event.isComposing) return
							if (event.key === "Escape") {
								event.preventDefault()
								host.close()
							} else if (event.key === "Enter") {
								event.preventDefault()
								host.perform(event.shiftKey ? "previous" : "next")
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
			editor.focus()
			editor.setSelectionRange(match.index, match.index + match[0].length)
			editor.dispatchEvent(new Event("select"))
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
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		this.lifetime = undefined
		if (lifetime) Effect.runFork(Fiber.interrupt(lifetime))
	}
	connectedMoveCallback() {}
	private expression() {
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
			toast("Invalid regular expression")
		}
	}
}
customElements.define("alkalye-find", FindElement)
