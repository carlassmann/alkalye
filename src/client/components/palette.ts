import { icon } from "../icons"
import { element, setMarkup } from "../dom"
import type { Markup } from "../language"
import { html, joinMarkup, translate } from "../language"

export function openPalette(
	dialog: HTMLDialogElement,
	showDialog: (title: string, body: string | Markup) => void,
	run: (action: string) => Promise<void>,
	report: (error: unknown) => void,
	available?: ReadonlySet<string>,
) {
	let commands: [string, string][] = [
		["new", "New document"],
		["preview", translate("Preview")],
		["history", translate("Time machine")],
		["slideshow", translate("Slideshow")],
		["teleprompter", translate("Teleprompter")],
		["focus", "Focus mode"],
		["share", translate("Share document")],
		["settings", translate("Settings")],
		["open-file", translate("Open local file")],
		["open-folder", translate("Open local folder")],
		["find", translate("Find")],
		["comment", translate("Add comment")],
		["whiteboard", translate("Whiteboard")],
		["undo", translate("Undo")],
		["redo", translate("Redo")],
		["table", "Insert table"],
		["code-block", "Insert code block"],
		["slide-break", "Insert slide break"],
		["sort-tasks", "Sort tasks"],
		["complete", "Toggle task completion"],
		["ordered", "Numbered list"],
		["quote", "Quote"],
		["strike", translate("Strikethrough")],
		["clear", "Clear formatting"],
		["h1", "Heading 1"],
		["h2", "Heading 2"],
		["h3", "Heading 3"],
		["h4", "Heading 4"],
		["h5", "Heading 5"],
		["h6", "Heading 6"],
	]
	showDialog(
		translate("Command palette"),
		html`<div data-palette class="command-search">
				${icon("search")}<input
					type="search"
					id="command-search"
					placeholder="${translate("Type a command…")}"
					aria-label="${translate("Search commands")}"
					role="combobox"
					aria-controls="commands"
					aria-expanded="true"
					spellcheck="false"
				/><button
					type="button"
					value="cancel"
					aria-label="${translate("Close")}"
				>
					${icon("x")}
				</button>
			</div>
			<div data-palette id="commands" role="listbox"></div>`,
	)
	let search = dialog.querySelector("#command-search")
	if (!(search instanceof HTMLInputElement)) return
	let selected = 0
	function select(index: number) {
		let items = [
			...dialog.querySelectorAll<HTMLButtonElement>("[data-command]"),
		]
		selected = items.length ? (index + items.length) % items.length : -1
		for (let [position, item] of items.entries()) {
			item.setAttribute("aria-selected", String(position === selected))
			item.dataset.active = String(position === selected)
		}
		let active = items[selected]
		if (active) {
			search?.setAttribute("aria-activedescendant", active.id)
			active.scrollIntoView({ block: "nearest" })
		} else search?.removeAttribute("aria-activedescendant")
	}
	function show() {
		setMarkup(
			element("#commands"),
			joinMarkup(
				commands
					.filter(([action]) => !available || available.has(action))
					.map(([action, label]) => ({ action, label: translate(label) }))
					.filter(value =>
						value.label
							.toLowerCase()
							.includes(
								search instanceof HTMLInputElement
									? search.value.toLowerCase()
									: "",
							),
					)
					.map(
						value =>
							html`<button
								type="button"
								role="option"
								tabindex="-1"
								id="command-${value.action}"
								data-command="${value.action}"
							>
								${value.label}
							</button>`,
					),
				"",
			),
		)
		for (let button of dialog.querySelectorAll<HTMLButtonElement>(
			"[data-command]",
		))
			button.onclick = () => {
				dialog.close()
				void run(button.dataset.command ?? "").catch(report)
			}
		for (let [index, button] of [
			...dialog.querySelectorAll<HTMLButtonElement>("[data-command]"),
		].entries())
			button.onpointermove = () => select(index)
		if (!dialog.querySelector("[data-command]"))
			setMarkup(
				element("#commands"),
				html`<p class="command-empty">${translate("No results")}</p>`,
			)
		select(0)
	}
	search.oninput = show
	search.onkeydown = event => {
		if (event.key === "Enter") {
			event.preventDefault()
			dialog
				.querySelectorAll<HTMLButtonElement>("[data-command]")
				[selected]?.click()
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault()
			select(selected + (event.key === "ArrowDown" ? 1 : -1))
		}
	}
	show()
	search.focus()
}
