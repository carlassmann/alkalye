import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberHandle from "effect/FiberHandle"
import type { Replica } from "../../shared/crdt"
import type { loadDocumentHistory } from "../document-history"
import { historyDays, historyIndices, momentDate } from "../history-timeline"
import { setMarkup } from "../dom"
import { icon } from "../icons"
import { html, joinMarkup } from "../language"
import { PickerElement, pickerMarkup } from "./menu"
import type { EditorElement } from "./editor"

interface HistoryOptions {
	document: string
	load: Effect.Effect<
		Effect.Success<ReturnType<typeof loadDocumentHistory>>,
		unknown
	>
	mountSource(host: HTMLElement, replica: Replica): EditorElement
	author(subject: string): string
	writable(): boolean
	run(command: Effect.Effect<unknown, unknown>): Promise<unknown>
	restore(replica: Replica, position: number): Effect.Effect<unknown, unknown>
	createCopy(
		replica: Replica,
		position: number,
	): Effect.Effect<unknown, unknown>
	report(error: unknown): void
}

export function mountDocumentHistory(
	host: HTMLElement,
	options: HistoryOptions,
) {
	let component = new HistoryElement()
	component.configure(options)
	host.replaceChildren(component)
	return component
}

export class HistoryElement extends HTMLElement {
	private options: HistoryOptions | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(options: HistoryOptions) {
		this.options = options
		this.dataset.history = ""
	}
	connectedCallback() {
		let configured = this.options
		if (!configured || this.lifetime) return
		let options = configured
		let host = this
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let replay = yield* FiberHandle.makeRuntime<never, never>()
					let hold = yield* FiberHandle.makeRuntime<never, never, void>()
					let events = yield* Effect.acquireRelease(
						Effect.sync(() => new AbortController()),
						events => Effect.sync(() => events.abort()),
					)
					setMarkup(
						host,
						html`<header class="history-header">
								<button data-action="edit" aria-label="Exit time machine">
									${icon("x")}<span>Exit</span>
								</button>
								<div class="history-title">
									<strong>Time Machine</strong><small id="history-date"></small>
								</div>
								<alkalye-menu class="tool-group"
									><button aria-label="History actions" aria-haspopup="menu">
										${icon("ellipsis")}
									</button>
									<div
										id="history-actions"
										class="menu-popover"
										popover
										role="menu"
										aria-label="History actions"
									>
										<button id="duplicate-history" disabled>
											${icon("copy")}Create copy
										</button>
										<button id="restore-history" disabled>
											${icon("history")}Restore this version
										</button>
										<hr />
										<button id="copy-history" disabled>
											${icon("clipboard")}Copy Markdown
										</button>
										<alkalye-menu data-submenu class="tool-group"
											><button>
												${icon("list")}Document records ${icon("chevron-right")}
											</button>
											<div
												id="history-records"
												class="menu-popover history-records"
												popover
											></div
										></alkalye-menu></div
								></alkalye-menu>
							</header>
							<div
								id="history-source"
								class="history-source"
								aria-busy="true"
							></div>
							<footer class="history-navigation" hidden></footer>`,
					)
					let history = yield* options.load
					let moments = history.moments
					let navigation = host.querySelector<HTMLElement>(
						".history-navigation",
					)
					let sourceControl = host.querySelector<HTMLElement>("#history-source")
					let restoreControl =
						host.querySelector<HTMLButtonElement>("#restore-history")
					let duplicateControl =
						host.querySelector<HTMLButtonElement>("#duplicate-history")
					let copyControl =
						host.querySelector<HTMLButtonElement>("#copy-history")
					if (
						!navigation ||
						!sourceControl ||
						!restoreControl ||
						!duplicateControl ||
						!copyControl
					)
						return
					setMarkup(
						navigation,
						html` <button id="history-older" aria-label="Previous version">
								${icon("chevron-left")}<span>Previous</span>
							</button>
							<button id="history-newer" aria-label="Next version">
								<span>Next</span>${icon("chevron-right")}
							</button>
							${pickerMarkup("history-day", "History date", [{ value: "", label: `All history (${moments.length})` }, ...historyDays(moments).map(day => ({ value: day.value, label: `${day.label} (${day.count})` }))], "")}
							<input
								id="history-position"
								aria-label="History position"
								type="range"
								min="0"
								max="${moments.length - 1}"
								value="${moments.length - 1}"
								step="1"
							/>
							<output id="history-label" aria-live="polite"></output>
							${history.complete ? "" : html`<small class="history-offline">Reconnect for newer edits</small>`}`,
					)
					navigation.hidden = false
					let sliderControl =
						navigation.querySelector<HTMLInputElement>("#history-position")
					let picker = navigation.querySelector("alkalye-picker")
					let olderControl =
						navigation.querySelector<HTMLButtonElement>("#history-older")
					let newerControl =
						navigation.querySelector<HTMLButtonElement>("#history-newer")
					let labelControl =
						navigation.querySelector<HTMLOutputElement>("#history-label")
					let dateControl = host.querySelector<HTMLElement>("#history-date")
					let recordsControl =
						host.querySelector<HTMLElement>("#history-records")
					if (
						!sliderControl ||
						!(picker instanceof PickerElement) ||
						!olderControl ||
						!newerControl ||
						!labelControl ||
						!dateControl ||
						!recordsControl
					)
						return
					let source = sourceControl
					let restore = restoreControl
					let duplicate = duplicateControl
					let copy = copyControl
					let slider = sliderControl
					let older = olderControl
					let newer = newerControl
					let label = labelControl
					let date = dateControl
					let records = recordsControl
					let indices = historyIndices(moments, "")
					let selected: Replica | undefined
					let position = 0
					let busy = false
					let editor: EditorElement | undefined
					function updateActions() {
						restore.disabled = busy || !selected || !options.writable()
						duplicate.disabled = busy || !selected
						copy.disabled = busy || !selected
					}
					function command(task: Effect.Effect<unknown, unknown>) {
						if (busy) return
						busy = true
						updateActions()
						// A copy belongs to the app task scope and must survive leaving this view.
						void options
							.run(task)
							.catch(options.report)
							.finally(() => {
								busy = false
								if (host.isConnected) updateActions()
							})
					}
					function select(index: number, delay = false) {
						index = Math.max(0, Math.min(indices.length - 1, index))
						let momentIndex = indices[index]
						let moment =
							momentIndex === undefined ? undefined : moments[momentIndex]
						if (!moment) return
						selected = undefined
						updateActions()
						slider.value = String(index)
						slider.max = String(indices.length - 1)
						slider.disabled = indices.length < 2
						older.disabled = index === 0
						newer.disabled = index === indices.length - 1
						label.value = `${index + 1} / ${indices.length}`
						slider.title = momentDate(moment).toLocaleString()
						slider.setAttribute(
							"aria-valuetext",
							`${slider.title}, ${moment.action.label}`,
						)
						slider.style.setProperty(
							"--history-progress",
							`${indices.length < 2 ? 100 : (index / (indices.length - 1)) * 100}%`,
						)
						replay(
							Effect.gen(function* () {
								if (delay) yield* Effect.sleep("100 millis")
								let replica = yield* history.at(moment.position)
								yield* Effect.sync(() => {
									selected = replica
									position = moment.position
									if (editor)
										editor.update(
											replica.text(options.document),
											replica.visible(options.document),
											false,
										)
									else editor = options.mountSource(source, replica)
									source.setAttribute("aria-busy", "false")
									date.textContent = `${momentDate(moment).toLocaleString()} by ${options.author(moment.action.subject)}`
									setMarkup(
										records,
										html`${joinMarkup(
											["comment", "asset", "whiteboard", "theme"].map(
												type =>
													html`<section>
														<h3>${type}</h3>
														${joinMarkup(replica.records(type).map(record => html`<p data-history-record="${record.id}">${record.fields.name || record.fields.body || type}</p>`))}
													</section>`,
											),
										)}`,
									)
									updateActions()
								})
							}).pipe(
								Effect.catch(error => Effect.sync(() => options.report(error))),
							),
						)
					}
					let signal = events.signal
					slider.addEventListener(
						"input",
						() => select(Number(slider.value), true),
						{ signal },
					)
					slider.addEventListener(
						"change",
						() => select(Number(slider.value)),
						{ signal },
					)
					picker.addEventListener(
						"change",
						() => {
							let previous = indices[Number(slider.value)]
							indices = historyIndices(moments, picker.value)
							select(
								picker.value
									? indices.length - 1
									: indices.indexOf(previous ?? -1),
							)
						},
						{ signal },
					)
					function stopHold() {
						hold(Effect.void)
						older.removeAttribute("data-holding")
						newer.removeAttribute("data-holding")
					}
					function bindNavigation(
						control: HTMLButtonElement,
						direction: number,
					) {
						let pointerHandled = false
						control.addEventListener(
							"pointerdown",
							event => {
								if (!event.isPrimary || event.button || control.disabled) return
								stopHold()
								pointerHandled = true
								control.setPointerCapture(event.pointerId)
								control.setAttribute("data-holding", "")
								select(Number(slider.value) + direction)
								hold(
									Effect.gen(function* () {
										yield* Effect.sleep("1500 millis")
										control.removeAttribute("data-holding")
										while (!control.disabled) {
											select(Number(slider.value) + direction)
											yield* Effect.sleep("100 millis")
										}
									}),
								)
							},
							{ signal },
						)
						for (let type of [
							"pointerup",
							"pointercancel",
							"pointerleave",
							"lostpointercapture",
						])
							control.addEventListener(type, stopHold, { signal })
						control.addEventListener(
							"click",
							event => {
								if (event.detail === 0 || !pointerHandled)
									select(Number(slider.value) + direction)
								pointerHandled = false
							},
							{ signal },
						)
					}
					bindNavigation(older, -1)
					bindNavigation(newer, 1)
					window.addEventListener("blur", stopHold, { signal })
					document.addEventListener("visibilitychange", stopHold, { signal })
					restore.addEventListener(
						"click",
						() => {
							if (selected && options.writable())
								command(options.restore(selected, position))
						},
						{ signal },
					)
					duplicate.addEventListener(
						"click",
						() => {
							if (selected) command(options.createCopy(selected, position))
						},
						{ signal },
					)
					copy.addEventListener(
						"click",
						() => {
							if (!selected) return
							let content = selected.text(options.document)
							command(
								Effect.tryPromise(() => navigator.clipboard.writeText(content)),
							)
						},
						{ signal },
					)
					window.addEventListener(
						"keydown",
						event => {
							if (
								busy ||
								event.defaultPrevented ||
								event.isComposing ||
								document.querySelector("dialog[open]") ||
								event.altKey ||
								event.ctrlKey ||
								event.metaKey ||
								host.querySelector(
									'[role="menu"]:popover-open, [role="listbox"]:popover-open',
								) ||
								(event.target instanceof HTMLTextAreaElement &&
									!event.target.readOnly)
							)
								return
							if (event.key !== "[" && event.key !== "]") return
							event.preventDefault()
							select(Number(slider.value) + (event.key === "[" ? -1 : 1))
						},
						{ signal },
					)
					select(indices.length - 1)
					yield* Effect.never
				}),
			).pipe(
				Effect.catch(error =>
					Effect.sync(() => {
						options.report(error)
						let source = host.querySelector<HTMLElement>("#history-source")
						if (source)
							setMarkup(
								source,
								html`<div class="history-error">
									<p>${String(error)}</p>
									<button data-action="history">Retry history</button>
								</div>`,
							)
					}),
				),
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
customElements.define("alkalye-history", HistoryElement)
