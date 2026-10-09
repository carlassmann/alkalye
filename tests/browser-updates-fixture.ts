import * as Effect from "effect/Effect"
import { watchUpdates } from "../src/client/updates"
import { UpdateBannerElement } from "../src/client/components/update-banner"

let events = new AbortController()
let editor = document.querySelector("textarea")
let release = document.querySelector("[data-release]")
if (
	!(editor instanceof HTMLTextAreaElement) ||
	!(release instanceof HTMLButtonElement)
)
	throw new Error("Missing update fixture controls")
editor.value = localStorage.getItem("draft") ?? ""
let input = editor
let button = release
let flush = Promise.withResolvers<void>()
button.onclick = () => flush.resolve()
document
	.querySelector("[data-abort]")
	?.addEventListener("click", () => events.abort())
await Effect.runPromise(
	watchUpdates(
		events.signal,
		apply => {
			let banner = new UpdateBannerElement()
			banner.offer(() => {
				document.body.dataset.flushing = "true"
				void flush.promise.then(() => {
					if (events.signal.aborted) return
					localStorage.setItem("draft", input.value)
					apply()
				})
			})
			document.body.append(banner)
			document.body.dataset.offered = "true"
		},
		() => {
			document.body.dataset.offlineReady = "true"
		},
	),
)
document.body.dataset.ready = "true"
