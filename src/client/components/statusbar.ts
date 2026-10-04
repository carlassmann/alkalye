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
	private content = ""
	private counts = documentStats("")
	private unit: StatsUnit = "words"
	connectedCallback() {
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
			this.unit = unit
			this.paint()
			this.dispatchEvent(new Event("change", { bubbles: true }))
		}
		this.paint()
	}
	disconnectedCallback() {
		this.onclick = null
		super.disconnectedCallback()
	}
	get value() {
		return this.unit
	}
	update(content: string, unit: StatsUnit) {
		if (content !== this.content) {
			this.content = content
			this.counts = documentStats(content)
		}
		this.unit = unit
		this.paint()
	}
	private paint() {
		this.hidden = this.unit === "hidden"
		let label = this.querySelector("#stats")
		if (label)
			label.textContent =
				statValue(this.counts, this.unit) + " " + translate(this.unit)
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
		<span id="save-status"> </span>
		<button id="retry-save" data-action="retry-save" hidden>
			Retry local save
		</button>
		<span id="presence"> </span>
	</footer>`
}
