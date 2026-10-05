import { icon } from "../icons"
import { setMarkup } from "../dom"
import type { Markup } from "../language"
import { html, rawMarkup, translate } from "../language"

let dialogEvents = new WeakMap<HTMLDialogElement, AbortController>()

export function openDialog(
	dialog: HTMLDialogElement,
	report: (error: unknown) => void,
	saved: () => void,
	title: string,
	body: string | Markup,
	onSubmit?: (form: FormData) => Promise<unknown>,
	submitLabel = "Save",
) {
	dialogEvents.get(dialog)?.abort()
	let events = new AbortController()
	dialogEvents.set(dialog, events)
	dialog.setAttribute("closedby", "any")
	let outsidePointer = false
	dialog.addEventListener(
		"pointerdown",
		event => {
			let bounds = dialog.getBoundingClientRect()
			outsidePointer =
				event.target === dialog &&
				(event.clientX < bounds.left ||
					event.clientX > bounds.right ||
					event.clientY < bounds.top ||
					event.clientY > bounds.bottom)
		},
		{ signal: events.signal },
	)
	dialog.addEventListener(
		"click",
		event => {
			if (event.target !== dialog || !outsidePointer) return
			let bounds = dialog.getBoundingClientRect()
			if (
				event.clientX < bounds.left ||
				event.clientX > bounds.right ||
				event.clientY < bounds.top ||
				event.clientY > bounds.bottom
			)
				dialog.close("cancel")
		},
		{ signal: events.signal },
	)
	dialog.addEventListener("close", () => events.abort(), {
		once: true,
		signal: events.signal,
	})
	dialog.classList.remove("wide")
	setMarkup(
		dialog,
		html`<form method="dialog">
			<header>
				<h2 id="dialog-title">${title}</h2>
				<button
					class="dialog-close"
					type="button"
					value="cancel"
					aria-label="Close"
				>
					${icon("x")}
				</button>
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
	dialog.setAttribute("aria-labelledby", "dialog-title")
	if (!dialog.open) dialog.showModal()
	form
		?.querySelector<HTMLElement>(
			'.dialog-body input:not([type="hidden"]), .dialog-body textarea, .dialog-body button, footer button',
		)
		?.focus({ preventScroll: true })
}
export function field(label: string, name: string, value = "", type = "text") {
	return html`<label
		>${label}<input name="${name}" type="${type}" value="${value}"
	/></label>`
}
