import { element, setMarkup } from "../dom"
import type { Markup } from "../language"
import { html, joinMarkup, localizeMarkup, translate } from "../language"

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
		localizeMarkup(
			'<input id="command-search" placeholder="Type a command…" aria-label="Search commands"><div data-palette id="commands"></div>',
		),
	)
	let search = dialog.querySelector("#command-search")
	if (!(search instanceof HTMLInputElement)) return
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
							html`<button type="button" data-command="${value.action}">
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
	}
	search.oninput = show
	search.onkeydown = event => {
		if (event.key === "Enter") {
			event.preventDefault()
			dialog.querySelector<HTMLButtonElement>("[data-command]")?.click()
		}
	}
	show()
	search.focus()
}
