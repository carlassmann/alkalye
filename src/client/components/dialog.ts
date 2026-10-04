import { setMarkup } from "../dom"
import type { Markup } from "../language"
import { html, rawMarkup, translate } from "../language"

export function openDialog(
	dialog: HTMLDialogElement,
	report: (error: unknown) => void,
	saved: () => void,
	title: string,
	body: string | Markup,
	onSubmit?: (form: FormData) => Promise<unknown>,
	submitLabel = "Save",
) {
	dialog.classList.remove("wide")
	setMarkup(
		dialog,
		html`<form method="dialog">
			<header>
				<h2>${title}</h2>
				<button type="button" value="cancel" aria-label="Close">×</button>
			</header>
			<div class="dialog-body">${rawMarkup(body)}</div>
			${onSubmit ? html`<footer><button type="button" value="cancel">${translate("Cancel")}</button><button class="primary" id="submit-dialog" value="save">${translate(submitLabel)}</button></footer>` : ""}
		</form>`,
	)
	let form = dialog.querySelector("form")
	// Closing buttons are not submit buttons: Enter, or Go on a phone keyboard,
	// submits with the first submit button, which must be the form's action.
	for (let close of dialog.querySelectorAll<HTMLButtonElement>(
		'button[value="cancel"]',
	))
		close.onclick = () => dialog.close("cancel")
	if (form && onSubmit)
		form.onkeydown = event => {
			if (
				!event.isComposing &&
				(event.metaKey || event.ctrlKey) &&
				event.key === "Enter"
			) {
				event.preventDefault()
				let submit = form.querySelector<HTMLButtonElement>("#submit-dialog")
				if (submit && !submit.disabled) form.requestSubmit(submit)
			}
		}
	if (form && onSubmit)
		form.onsubmit = event => {
			if (
				event.submitter instanceof HTMLButtonElement &&
				event.submitter.value === "cancel"
			)
				return
			event.preventDefault()
			let data = new FormData(form)
			let submit = form.querySelector<HTMLButtonElement>("#submit-dialog")
			if (submit) submit.disabled = true
			void onSubmit(data)
				.then(() => {
					if (!dialog.open || dialog.querySelector("form") !== form) return
					dialog.close()
					saved()
				})
				.catch(error => {
					if (dialog.open && dialog.querySelector("form") === form)
						report(error)
				})
				.finally(() => {
					if (submit) submit.disabled = false
				})
		}
	if (!dialog.open) dialog.showModal()
}
export function field(label: string, name: string, value = "", type = "text") {
	return html`<label
		>${label}<input name="${name}" type="${type}" value="${value}"
	/></label>`
}
