import { translate } from "../language"

export function showProgress(
	label: string,
	total: number,
	cancel?: () => void,
) {
	let panel = document.createElement("section")
	panel.dataset.progress = ""
	panel.setAttribute("role", "status")
	let text = document.createElement("span"),
		progress = document.createElement("progress")
	progress.max = Math.max(1, total)
	progress.value = 0
	progress.setAttribute("aria-label", translate(label))
	text.textContent = translate(label)
	panel.append(text, progress)
	if (cancel) {
		let button = document.createElement("button")
		button.type = "button"
		button.textContent = translate("Cancel")
		button.onclick = cancel
		panel.append(button)
	}
	document.body.append(panel)
	return {
		update(name: string, completed: number) {
			text.textContent = `${translate(label)} · ${name}`
			progress.value = completed
		},
		finish() {
			panel.remove()
		},
	}
}
