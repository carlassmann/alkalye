import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import {
	confirmDialog,
	openDialog,
	promptDialog,
} from "../../src/client/components/dialog"
import { html } from "../../src/client/language"

let dialog = document.querySelector("dialog")
let result = document.querySelector("output")
if (!(dialog instanceof HTMLDialogElement) || !result)
	throw new Error("Missing fixture")
let modal = dialog,
	output = result
let current: Fiber.Fiber<void> | undefined
function run(question: Effect.Effect<string | boolean | undefined>) {
	output.textContent = "pending"
	current = Effect.runFork(
		question.pipe(
			Effect.tap(value =>
				Effect.sync(() => {
					output.textContent = value === undefined ? "cancelled" : String(value)
				}),
			),
			Effect.asVoid,
		),
	)
}
document
	.querySelector("#confirm")
	?.addEventListener("click", () =>
		run(confirmDialog(modal, "Delete the document?", "Delete")),
	)
document
	.querySelector("#prompt")
	?.addEventListener("click", () =>
		run(promptDialog(modal, "Document title", "Existing title")),
	)
document.querySelector("#replace")?.addEventListener("click", () => {
	openDialog(
		modal,
		() => {},
		() => {},
		"Commands",
		html`<button type="button" id="next">Rename</button>`,
	)
	modal.querySelector("#next")?.addEventListener("click", () => {
		modal.close()
		run(promptDialog(modal, "Document title", "Existing title"))
	})
})
document.addEventListener("keydown", event => {
	if (event.key === "F2" && current) Effect.runFork(Fiber.interrupt(current))
})
