import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { element, setMarkup } from "../dom"
import { icon } from "../icons"
import { html } from "../language"
import { toast } from "./toast"
import { replaceSelectedMatch } from "../../shared/find"
import type { SourceTextarea } from "../source-textarea"
import { EditorElement } from "./editor"

let lastSearch = { query: "", replacement: "", sensitive: false, regex: false }

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
		return existing.focusSearch(query, true)
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
	private selectionScope: { start: number; end: number } | undefined
	private scopeSource = ""
	private replacedRange: { start: number; end: number } | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(host: EditorElement, close: () => void, query = "") {
		this.host = host
		this.editor = host.source
		this.close = close
		this.query = query || lastSearch.query
		let source = host.source
		this.scopeSource = source?.value ?? ""
		this.selectionScope =
			source && source.selectionStart !== source.selectionEnd
				? { start: source.selectionStart, end: source.selectionEnd }
				: undefined
	}
	focusSearch(query = "", capture = false) {
		if (capture) this.captureSelection()
		this.replacedRange = undefined
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
								<label class="find-selection-only"
									><input id="find-selection-only" type="checkbox" />Selection
									only</label
								>
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
								<button
									type="button"
									data-find-action="close"
									id="close-find"
									aria-label="Close find"
									title="Close find (Esc)"
								>
									${icon("x")}
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
					host.addEventListener(
						"input",
						() => {
							host.replacedRange = undefined
							host.refreshCount()
						},
						{
							signal: events.signal,
						},
					)
					editor.element.addEventListener("input", () => host.refreshCount(), {
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
								!document.querySelector("dialog[open]") &&
								!document.querySelector(
									'[role="menu"]:popover-open, [role="listbox"]:popover-open',
								)
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
								if (event.metaKey || event.ctrlKey) editor.focus()
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
					let replacement =
						host.querySelector<HTMLInputElement>("#replace-text")
					let sensitive = host.querySelector<HTMLInputElement>("#find-case")
					let regex = host.querySelector<HTMLInputElement>("#find-regex")
					let selectionOnly = host.querySelector<HTMLInputElement>(
						"#find-selection-only",
					)
					if (replacement) replacement.value = lastSearch.replacement
					if (sensitive) sensitive.checked = lastSearch.sensitive
					if (regex) regex.checked = lastSearch.regex
					if (selectionOnly) selectionOnly.disabled = !host.selectionScope
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
		this.trackScope()
		let pattern = this.expression()
		if (!pattern) return
		if (action === "next" || action === "previous") {
			this.replacedRange = undefined
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
		let selectionOnly = this.querySelector<HTMLInputElement>(
			"#find-selection-only",
		)?.checked
		let scope = selectionOnly ? this.selectionScope : undefined
		if (action === "replace-all") {
			if (scope) {
				let original = editor.value
				let changed = original.slice(scope.start, scope.end)
				let scopedPattern = new RegExp(pattern)
				scopedPattern.lastIndex = scope.start
				let matches = [...original.matchAll(scopedPattern)].filter(
					match =>
						match.index >= scope.start &&
						match.index + match[0].length <= scope.end,
				)
				for (let match of matches.reverse()) {
					let inserted = this.querySelector<HTMLInputElement>("#find-regex")
						?.checked
						? replaceSelectedMatch(
								original,
								pattern,
								replacement.value,
								match.index,
								match.index + match[0].length,
							)
						: replacement.value
					if (inserted === undefined) continue
					let offset = match.index - scope.start
					changed =
						changed.slice(0, offset) +
						inserted +
						changed.slice(offset + match[0].length)
				}
				editor.setRangeText(changed, scope.start, scope.end, "preserve")
				this.selectionScope = {
					start: scope.start,
					end: scope.start + changed.length,
				}
			} else {
				let original = editor.value
				let regex = this.querySelector<HTMLInputElement>("#find-regex")?.checked
				let changed = regex
					? original.replace(pattern, replacement.value)
					: original.replace(pattern, () => replacement.value)
				if (this.selectionScope) {
					for (let match of [...original.matchAll(pattern)].reverse()) {
						let inserted = regex
							? replaceSelectedMatch(
									original,
									pattern,
									replacement.value,
									match.index,
									match.index + match[0].length,
								)
							: replacement.value
						if (inserted !== undefined)
							this.adjustScope(
								match.index,
								match.index + match[0].length,
								inserted.length,
							)
					}
				}
				editor.setRangeText(changed, 0, original.length, "preserve")
				this.scopeSource = changed
			}
		} else if (action === "replace") {
			let scopedPattern = new RegExp(pattern)
			if (scope) scopedPattern.lastIndex = scope.start
			let matches = [...editor.value.matchAll(scopedPattern)].filter(
				match =>
					!scope ||
					(match.index >= scope.start &&
						match.index + match[0].length <= scope.end),
			)
			let repeated =
				this.replacedRange?.start === editor.selectionStart &&
				this.replacedRange.end === editor.selectionEnd
			let match =
				(!repeated
					? matches.find(
							match =>
								match.index === editor.selectionStart &&
								match.index + match[0].length === editor.selectionEnd,
						)
					: undefined) ??
				matches.find(match => match.index >= editor.selectionEnd) ??
				matches[0]
			if (!match) return
			let changed = this.querySelector<HTMLInputElement>("#find-regex")?.checked
				? replaceSelectedMatch(
						editor.value,
						pattern,
						replacement.value,
						match.index,
						match.index + match[0].length,
					)
				: replacement.value
			if (changed === undefined) return
			if (scope)
				this.selectionScope = {
					start: scope.start,
					end: scope.end + changed.length - match[0].length,
				}
			editor.setRangeText(
				changed,
				match.index,
				match.index + match[0].length,
				"select",
			)
			this.replacedRange = {
				start: match.index,
				end: match.index + changed.length,
			}
			let focused = document.activeElement
			this.host?.selectRange(this.replacedRange.start, this.replacedRange.end)
			if (focused instanceof HTMLElement && this.contains(focused))
				focused.focus({ preventScroll: true })
		} else return
		if (scope) this.scopeSource = editor.value
		else this.trackScope()
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
		lastSearch = {
			query: this.querySelector<HTMLInputElement>("#find-text")?.value ?? "",
			replacement:
				this.querySelector<HTMLInputElement>("#replace-text")?.value ?? "",
			sensitive:
				this.querySelector<HTMLInputElement>("#find-case")?.checked ?? false,
			regex:
				this.querySelector<HTMLInputElement>("#find-regex")?.checked ?? false,
		}
		this.trackScope()
		let pattern = this.expression(false)
		this.host?.search(pattern)
		let matches = pattern ? [...this.editor.value.matchAll(pattern)] : []
		let current = matches.findIndex(
			match => match.index === this.editor?.selectionStart,
		)
		count.textContent = pattern
			? matches.length
				? `${Math.max(0, current + 1)} of ${matches.length}`
				: "No results"
			: ""
		for (let button of this.querySelectorAll<HTMLButtonElement>(
			"#find-next, #find-previous",
		))
			button.disabled = matches.length === 0
		count.toggleAttribute("data-empty", Boolean(pattern && !matches.length))
	}
	private captureSelection() {
		let editor = this.editor
		if (!editor) return
		this.scopeSource = editor.value
		this.selectionScope =
			editor.selectionStart !== editor.selectionEnd
				? { start: editor.selectionStart, end: editor.selectionEnd }
				: undefined
		let checkbox = this.querySelector<HTMLInputElement>("#find-selection-only")
		if (checkbox) {
			checkbox.disabled = !this.selectionScope
			if (!this.selectionScope) checkbox.checked = false
		}
	}

	private trackScope() {
		let source = this.editor?.value ?? ""
		let previous = this.scopeSource
		this.scopeSource = source
		let scope = this.selectionScope
		if (!scope || source === previous) return
		let start = 0
		while (
			start < source.length &&
			start < previous.length &&
			source[start] === previous[start]
		)
			start++
		let beforeEnd = previous.length,
			afterEnd = source.length
		while (
			beforeEnd > start &&
			afterEnd > start &&
			previous[beforeEnd - 1] === source[afterEnd - 1]
		) {
			beforeEnd--
			afterEnd--
		}
		this.adjustScope(start, beforeEnd, afterEnd - start)
	}
	private adjustScope(start: number, end: number, length: number) {
		let scope = this.selectionScope
		if (!scope) return
		function map(offset: number) {
			return offset <= start
				? offset
				: offset >= end
					? offset + length - (end - start)
					: start + length
		}
		this.selectionScope = { start: map(scope.start), end: map(scope.end) }
	}

	disconnectedCallback() {
		this.host?.search(undefined)
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
