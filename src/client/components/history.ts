import type { Replica } from "../../shared/crdt"
import { documentTimeline } from "../../shared/documents"
import { editGroups } from "../../shared/history"
import { setMarkup } from "../dom"
import { html, rawMarkup, joinMarkup } from "../language"

interface HistoryOptions {
	document: string
	load: Effect.Effect<
		Effect.Success<ReturnType<typeof loadDocumentHistory>>,
		unknown
	>
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
		let options: HistoryOptions = configured
		let host = this
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let run = yield* FiberSet.makeRuntime<never>()
					let replay = yield* FiberHandle.makeRuntime<never, never>()
					setMarkup(
						host,
						html`<section data-history aria-busy="true">
							<p>Loading document history…</p>
						</section>`,
					)
					let history = yield* options.load
					let versions = [...history.moments].reverse()
					setMarkup(
						host,
						html`<section data-history class="history-layout">
							<div class="history-list">
								<h2>Time machine</h2>
								<p class="muted">
									Source, comments, assets and drawings share one
									history.${history.complete ? "" : " Reconnect to load newer moments."}
								</p>
								${joinMarkup(versions.map((moment, index) => html`<button data-version="${index}" data-position="${moment.position}"><strong>${moment.action.label}</strong><small>${new Date(moment.action.changes.at(-1)?.time ?? 0).toLocaleString()} · ${moment.action.subject}</small></button>`))}
							</div>
							<div class="history-content">
								<div class="history-navigation">
									<button id="history-older" aria-label="Older version">
										←</button
									><input
										id="history-position"
										aria-label="History position"
										type="range"
										min="0"
										max="${versions.length - 1}"
										value="0"
									/><button id="history-newer" aria-label="Newer version">
										→</button
									><output id="history-label"></output>
								</div>
								<div id="history-actions">
									<button id="restore-history" class="primary">
										Restore this version</button
									><button id="copy-history">Copy Markdown</button
									><button id="duplicate-history">Create copy</button
									><span
										>Restoring adds an action. Current permissions remain.</span
									>
								</div>
								<pre id="history-source"></pre>
								<div id="history-records"></div>
							</div>
						</section>`,
					)
					let sliderControl = host.querySelector("#history-position")
					let restoreControl = host.querySelector("#restore-history")
					if (
						!(sliderControl instanceof HTMLInputElement) ||
						!(restoreControl instanceof HTMLButtonElement)
					)
						return
					let slider = sliderControl
					let restore = restoreControl
					let selected: Replica | undefined
					let position = 0
					let busy = false
					function execute(task: Effect.Effect<unknown, unknown>) {
						run(
							task.pipe(
								Effect.catch(error => Effect.sync(() => options.report(error))),
							),
						)
					}
					function command(task: Effect.Effect<unknown, unknown>) {
						if (busy) return
						busy = true
						restore.disabled = true
						let duplicate =
							host.querySelector<HTMLButtonElement>("#duplicate-history")
						if (duplicate) duplicate.disabled = true
						void options
							.run(task)
							.catch(options.report)
							.finally(() => {
								busy = false
								if (!host.isConnected) return
								restore.disabled = busy || !options.writable()
								if (duplicate) duplicate.disabled = false
							})
					}
					function select(index: number) {
						let moment =
							versions[Math.max(0, Math.min(versions.length - 1, index))]
						if (!moment) return
						selected = undefined
						restore.disabled = true
						replay(
							history.at(moment.position).pipe(
								Effect.tap(replica =>
									Effect.sync(() => {
										selected = replica
										position = moment.position
										slider.value = String(index)
										restore.disabled = busy || !options.writable()
										let source = host.querySelector("#history-source")
										let label = host.querySelector("#history-label")
										let records = host.querySelector("#history-records")
										if (source)
											source.textContent = replica.text(options.document)
										if (label)
											label.textContent = `${versions.length - index} / ${versions.length}`
										if (records instanceof HTMLElement)
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
										for (let button of host.querySelectorAll("[data-version]"))
											button.classList.toggle(
												"active",
												button.getAttribute("data-version") === String(index),
											)
									}),
								),
								Effect.catch(error => Effect.sync(() => options.report(error))),
							),
						)
					}
					slider.oninput = () => select(Number(slider.value))
					for (let button of host.querySelectorAll<HTMLButtonElement>(
						"[data-version]",
					))
						button.onclick = () => select(Number(button.dataset.version))
					let older = host.querySelector<HTMLButtonElement>("#history-older")
					let newer = host.querySelector<HTMLButtonElement>("#history-newer")
					let copy = host.querySelector<HTMLButtonElement>("#copy-history")
					let duplicate =
						host.querySelector<HTMLButtonElement>("#duplicate-history")
					if (older) older.onclick = () => select(Number(slider.value) + 1)
					if (newer) newer.onclick = () => select(Number(slider.value) - 1)
					restore.onclick = () => {
						if (selected && options.writable())
							command(options.restore(selected, position))
					}
					if (copy)
						copy.onclick = () => {
							if (!selected) return
							let source = selected.text(options.document)
							execute(
								Effect.tryPromise(() => navigator.clipboard.writeText(source)),
							)
						}
					if (duplicate)
						duplicate.onclick = () => {
							if (selected) command(options.createCopy(selected, position))
						}
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							for (let node of host.querySelectorAll<HTMLElement>("*")) {
								node.onclick = null
								node.oninput = null
							}
						}),
					)
					select(0)
					yield* Effect.never
				}),
			).pipe(
				Effect.catch(error =>
					Effect.sync(() => {
						options.report(error)
						setMarkup(
							host,
							html`<section data-history>
								<p>${String(error)}</p>
								<button data-action="history">Retry history</button>
							</section>`,
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
export function mountHistory(
	host: HTMLElement,
	replica: Replica,
	documentId: string,
	restore: (content: string, version: string) => void,
	copyDocument: (content: string, version: string) => void,
	writable: boolean,
) {
	let operations = documentTimeline(replica, documentId)
	let versions = editGroups(operations).reverse()
	setMarkup(
		host,
		html`<div data-history class="history-layout">
			<div class="history-list">
				<h2>Time machine</h2>
				<p class="muted">
					Typing is grouped into moments. Every edit remains saved.
				</p>
				${rawMarkup(
					versions
						.map((group, index) => {
							let latest = group.at(-1)
							if (!latest) return ""
							return html`<button
								data-version="${index}"
								data-clock="${latest.clock}"
							>
								<strong>${new Date(latest.time).toLocaleString()}</strong
								><small
									>${latest.author} ·
									${group.reduce((sum, operation) => sum + operation.insert.length, 0)}
									added,
									${group.reduce((sum, operation) => sum + operation.remove.length, 0)}
									removed</small
								>
							</button>`
						})
						.join(""),
				)}
			</div>
			<div class="history-content">
				<div class="history-navigation">
					<button id="history-older" aria-label="Older version">←</button
					><input
						id="history-position"
						aria-label="History position"
						type="range"
						min="0"
						max="${Math.max(0, versions.length - 1)}"
						value="0"
					/><button id="history-newer" aria-label="Newer version">→</button
					><output id="history-label"></output>
				</div>
				<div id="history-actions">
					<button id="restore-history" class="primary">
						Restore this version</button
					><button id="copy-history">Copy Markdown</button
					><button id="duplicate-history">Create copy</button
					><span>Restoring adds an edit and preserves later history.</span>
				</div>
				<pre id="history-source"></pre>
			</div>
		</div>`,
	)
	let slider = host.querySelector("#history-position")
	let source = host.querySelector("#history-source")
	let label = host.querySelector("#history-label")
	if (
		!(slider instanceof HTMLInputElement) ||
		!(source instanceof HTMLElement) ||
		!(label instanceof HTMLElement)
	)
		return
	let current = "",
		version = ""
	function select(index: number) {
		index = Math.max(0, Math.min(versions.length - 1, index))
		let latest = versions[index]?.at(-1)
		if (!latest) return
		current = replica.text(documentId, latest.id)
		version = latest.id
		if (slider instanceof HTMLInputElement) slider.value = String(index)
		if (source) source.textContent = current
		if (label)
			label.textContent = `${versions.length - index} / ${versions.length}`
		for (let button of host.querySelectorAll<HTMLButtonElement>(
			"[data-version]",
		))
			button.classList.toggle(
				"active",
				Number(button.dataset.version) === index,
			)
	}
	slider.oninput = () => select(Number(slider.value))
	for (let button of host.querySelectorAll<HTMLButtonElement>("[data-version]"))
		button.onclick = () => select(Number(button.dataset.version))
	let older = host.querySelector<HTMLButtonElement>("#history-older")
	let newer = host.querySelector<HTMLButtonElement>("#history-newer")
	let restoreButton = host.querySelector<HTMLButtonElement>("#restore-history")
	let copy = host.querySelector<HTMLButtonElement>("#copy-history")
	if (older) older.onclick = () => select(Number(slider.value) + 1)
	if (newer) newer.onclick = () => select(Number(slider.value) - 1)
	if (restoreButton) {
		restoreButton.disabled = !writable
		restoreButton.onclick = () => restore(current, version)
	}
	let duplicate = host.querySelector<HTMLButtonElement>("#duplicate-history")
	if (duplicate) duplicate.onclick = () => copyDocument(current, version)
	if (copy)
		copy.onclick = () => {
			void navigator.clipboard.writeText(current)
		}
	select(0)
}
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as FiberHandle from "effect/FiberHandle"
import type { loadDocumentHistory } from "../document-history"
