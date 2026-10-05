import * as Effect from "effect/Effect"
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
	dialog.addEventListener(
		"close",
		() => {
			if (!dialog.open) events.abort()
		},
		{
			signal: events.signal,
		},
	)
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
	return events.signal
}
export function mediaPreviewDialog(
	dialog: HTMLDialogElement,
	report: (error: unknown) => void,
	source: string,
	alt: string,
	kind: "image" | "video" | "audio",
) {
	return Effect.acquireUseRelease(
		Effect.sync(() => {
			let body =
				kind === "video"
					? html`<video
							data-image-preview
							src="${source}"
							aria-label="${alt}"
							controls
							playsinline
						></video>`
					: kind === "audio"
						? html`<audio
								data-image-preview
								src="${source}"
								aria-label="${alt}"
								controls
							></audio>`
						: html`<img data-image-preview src="${source}" alt="${alt}" />`
			let title =
				kind === "image"
					? "Preview image"
					: kind === "video"
						? "Preview video"
						: "Preview audio"
			let signal = openDialog(dialog, report, () => {}, title, body)
			return { signal, form: dialog.querySelector("form") }
		}),
		({ signal }) =>
			Effect.callback<void>(resume => {
				function closed() {
					resume(Effect.void)
				}
				if (signal.aborted) closed()
				else signal.addEventListener("abort", closed, { once: true })
				return Effect.sync(() => signal.removeEventListener("abort", closed))
			}),
		({ form }) =>
			Effect.sync(() => {
				if (dialog.open && dialog.querySelector("form") === form) dialog.close()
				let media = form?.querySelector("[data-image-preview]")
				if (media instanceof HTMLMediaElement) {
					media.pause()
					media.removeAttribute("src")
					media.load()
				}
				media?.remove()
			}),
	)
}

export function field(label: string, name: string, value = "", type = "text") {
	return html`<label
		>${label}<input name="${name}" type="${type}" value="${value}"
	/></label>`
}

export function confirmDialog(
	dialog: HTMLDialogElement,
	message: string,
	label = "Continue",
	title = translate(label === "Continue" ? "Confirm" : label),
) {
	return requestDialog(
		dialog,
		title,
		html`<p>${message}</p>`,
		() => true,
		label,
		true,
	)
}

export function promptDialog(
	dialog: HTMLDialogElement,
	label: string,
	value = "",
) {
	return requestDialog(
		dialog,
		label,
		field(label, "value", value),
		form => String(form.get("value") ?? ""),
		"Save",
	)
}

function requestDialog<A>(
	dialog: HTMLDialogElement,
	title: string,
	body: Markup,
	read: (form: FormData) => A,
	label: string,
	destructive = false,
) {
	return Effect.callback<A | undefined>(resume => {
		let result: A | undefined
		openDialog(
			dialog,
			() => resume(Effect.succeed(undefined)),
			() => resume(Effect.succeed(result)),
			title,
			body,
			form => {
				result = read(form)
				return Promise.resolve()
			},
			label,
		)
		if (destructive)
			dialog.querySelector("#submit-dialog")?.classList.add("destructive")
		let form = dialog.querySelector("form")
		let events = new AbortController()
		dialog.addEventListener(
			"close",
			() => {
				if (!dialog.open) resume(Effect.succeed(result))
			},
			{
				signal: events.signal,
			},
		)
		return Effect.sync(() => {
			events.abort()
			if (dialog.open && dialog.querySelector("form") === form)
				dialog.close("cancel")
		})
	})
}
