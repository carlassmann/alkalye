import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import type { makeDocumentWorkerStats } from "../document-worker-stats"
import {
	documentStats,
	statValue,
	statsUnits,
} from "../../shared/document-stats"
import type { StatsUnit } from "../../shared/document-stats"
import { setMarkup } from "../dom"
import { html, joinMarkup, translate } from "../language"
import { MenuElement } from "./menu"

export class StatsElement extends MenuElement {
	private runtime: ManagedRuntime.ManagedRuntime<never, unknown> | undefined
	private worker:
		Effect.Success<ReturnType<typeof makeDocumentWorkerStats>> | undefined
	private revision = 0
	private paintedRevision = -1
	private clearedRevision = -1
	private content = ""
	private counts = documentStats("")
	private unit: StatsUnit = "words"
	private pending: StatsUnit | undefined
	private available = false
	private requested = false
	private displayKey = ""
	connectedCallback() {
		this.displayKey = ""
		this.dataset.stats = ""
		setMarkup(
			this,
			html`<button
					id="stats"
					type="button"
					aria-label="Document statistics"
				></button>
				<div
					id="stats-menu"
					class="menu-popover"
					popover
					role="menu"
					aria-label="Document statistics"
				>
					${joinMarkup(statsUnits.map(unit => html`<button type="button" role="${unit === "hidden" ? "menuitem" : "menuitemradio"}" data-stats-unit="${unit}" aria-checked="false"><span>${translate(unit === "hidden" ? "Hide badge" : unit[0]?.toUpperCase() + unit.slice(1))}</span><small data-stat-value></small></button>`))}
				</div>`,
		)
		this.setAttribute("side", "top")
		super.connectedCallback()
		this.onclick = event => {
			if (!(event.target instanceof Element)) return
			let value =
				event.target.closest<HTMLElement>("[data-stats-unit]")?.dataset
					.statsUnit
			let unit = statsUnits.find(unit => unit === value)
			if (!unit) return
			this.pending = unit
			this.unit = unit
			this.paint()
			this.dispatchEvent(new Event("change", { bubbles: true }))
		}
		this.paint()
	}
	private startWorker() {
		if (this.runtime || this.unit === "hidden") return
		let owner = this
		let runtime = ManagedRuntime.make(
			Layer.effectDiscard(
				Effect.gen(function* () {
					let { makeDocumentWorkerStats } = yield* Effect.promise(
						() => import("../document-worker-stats"),
					)
					return yield* makeDocumentWorkerStats(result => {
						if (
							!owner.isConnected ||
							!owner.requested ||
							owner.runtime !== runtime ||
							result.revision <=
								Math.max(owner.clearedRevision, owner.paintedRevision)
						)
							return
						owner.paintedRevision = result.revision
						owner.counts = result.counts
						owner.available = true
						owner.paint()
					}).pipe(
						Effect.tap(worker =>
							Effect.sync(() => {
								if (owner.runtime !== runtime) return
								owner.worker = worker
								if (owner.requested)
									worker.update(owner.revision, owner.content)
							}),
						),
					)
				}),
			),
		)
		this.runtime = runtime
		runtime.runFork(Effect.void)
	}

	disconnectedCallback() {
		this.stopWorker()
		this.onclick = null
		super.disconnectedCallback()
	}
	private stopWorker() {
		this.worker = undefined
		let runtime = this.runtime
		this.runtime = undefined
		if (runtime) void runtime.dispose()
	}

	get value() {
		return this.unit
	}
	clear() {
		this.stopWorker()
		this.requested = false
		this.revision++
		this.clearedRevision = this.revision
		this.content = ""
		this.available = false
		this.paint()
	}
	update(content: string, unit: StatsUnit) {
		this.requested = true
		if (unit === "hidden") this.stopWorker()
		if (unit === this.pending) this.pending = undefined
		if (content !== this.content || !this.available) {
			this.content = content
			this.revision++
			this.worker?.update(this.revision, content)
		}
		this.unit = this.pending ?? unit
		this.startWorker()
		this.paint()
	}
	private paint() {
		let key = [
			this.available,
			this.unit,
			this.counts.words,
			this.counts.sentences,
			this.counts.tasks,
			this.counts.completedTasks,
			translate("Document statistics"),
			...statsUnits.map(unit => translate(unit)),
		].join("|")
		if (key === this.displayKey) return
		this.displayKey = key
		this.hidden = this.unit === "hidden" || !this.available
		let label = this.querySelector("#stats")
		if (label) {
			label.setAttribute(
				"aria-label",
				translate("Document statistics") +
					": " +
					statValue(this.counts, this.unit) +
					" " +
					translate(this.unit),
			)
			label.textContent =
				statValue(this.counts, this.unit) + " " + translate(this.unit)
		}
		for (let item of this.querySelectorAll<HTMLElement>("[data-stats-unit]")) {
			item.setAttribute(
				"aria-checked",
				String(item.dataset.statsUnit === this.unit),
			)
			let value = item.querySelector("[data-stat-value]")
			let unit = statsUnits.find(unit => unit === item.dataset.statsUnit)
			if (value && unit) value.textContent = statValue(this.counts, unit)
		}
	}
}
customElements.define("alkalye-stats", StatsElement)

export function statusbarMarkup() {
	return html` <footer data-statusbar class="statusbar">
		<alkalye-stats></alkalye-stats>
		<span id="save-status" data-quiet data-state="quiet">Saved</span>
		<button id="retry-save" data-action="retry-save" hidden>
			Retry local save
		</button>
		<span id="presence"> </span>
	</footer>`
}
