import { ViewportEditor } from "./editor"
import { NativeFloorEditor } from "./native-floor"
let params = new URLSearchParams(location.search)
let size = Number(params.get("size") ?? 131072)
let long = params.get("fixture") === "long"
let source = (
	long
		? "A long paragraph with **bold** and ==highlight==. "
		: "A document paragraph with **bold** and [a link](https://example.org).\n\n"
)
	.repeat(Math.ceil(size / 40))
	.slice(0, size)
let host = document.querySelector("main")
if (!(host instanceof HTMLElement)) throw Error("Missing host")
let editor =
	params.get("mode") === "bare"
		? new NativeFloorEditor(host, source)
		: new ViewportEditor(host, source, params.get("mode") !== "full")
Object.defineProperty(window, "viewportExperiment", { value: editor })
let caption = document.querySelector("p")
if (caption)
	caption.textContent = `${params.get("mode") ?? "bounded"} · ${size} characters · ${long ? "one wrapped paragraph" : "many paragraphs"}`
