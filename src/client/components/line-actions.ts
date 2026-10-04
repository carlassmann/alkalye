import { safeUrl } from "../../shared/markdown"
import type { DocumentLink } from "../../shared/model"
import { translate } from "../language"
import { icon } from "../icons"
import type { IconName } from "../icons"
import { setMarkup } from "../dom"
import type { SourceTextarea } from "../source-textarea"

interface LineActionsOptions {
	isDrawing(id: string): boolean
	openDrawing(id: string): void
	requestAsset(): void
	openDocument(id: string): void
	documents(): readonly DocumentLink[]
}

export function mountLineActions(
	editor: SourceTextarea,
	options: LineActionsOptions,
) {
	let toolbar = document.createElement("div")
	toolbar.dataset.lineActions = ""
	toolbar.setAttribute("role", "toolbar")
	toolbar.setAttribute("aria-label", translate("Line actions"))
	let signature = ""
	document.body.append(toolbar)
	let viewport = window.visualViewport
	let baselineHeight = viewportHeight()
	let frame = 0
	let touch = "ontouchstart" in window || navigator.maxTouchPoints > 0
	if (viewport && touch) {
		viewport.addEventListener("resize", schedulePosition)
		viewport.addEventListener("scroll", schedulePosition)
		window.addEventListener("orientationchange", resetViewport)
	}
	toolbar.onpointerdown = event => event.preventDefault()
	for (let target of [editor.element, toolbar]) {
		target.addEventListener("focusin", focusChanged)
		target.addEventListener("focusout", focusChanged)
	}
	position()
	for (let event of ["input", "select", "keyup", "click", "scroll"])
		editor.element.addEventListener(event, update)
	update()
	return {
		update,
		dispose() {
			for (let event of ["input", "select", "keyup", "click", "scroll"])
				editor.element.removeEventListener(event, update)
			viewport?.removeEventListener("resize", schedulePosition)
			viewport?.removeEventListener("scroll", schedulePosition)
			window.removeEventListener("orientationchange", resetViewport)
			cancelAnimationFrame(frame)
			for (let target of [editor.element, toolbar]) {
				target.removeEventListener("focusin", focusChanged)
				target.removeEventListener("focusout", focusChanged)
			}
			toolbar.remove()
		},
	}

	function update() {
		let start =
			editor.value.slice(0, editor.selectionStart).lastIndexOf("\n") + 1
		let end = editor.value.indexOf("\n", editor.selectionStart)
		if (end < 0) end = editor.value.length
		let line = editor.value.slice(start, end)
		let next = JSON.stringify([
			start,
			line,
			editor.readOnly,
			line.includes("[[")
				? options.documents().map(doc => [doc.id, doc.title])
				: [],
		])
		if (signature !== next) {
			signature = next
			toolbar.replaceChildren()
			let task = /^(\s*[-*+] \[)([ xX])\]/.exec(line)
			if (task && !editor.readOnly) {
				let offset = start + (task[1]?.length ?? 0)
				let completed = task[2]?.toLowerCase() === "x"
				let button = action(
					completed ? "Reopen task" : "Complete task",
					"check",
				)
				button.setAttribute("aria-keyshortcuts", "Control+Alt+X Meta+Alt+X")
				button.onclick = () => {
					editor.setRangeText(
						completed ? " " : "x",
						offset,
						offset + 1,
						"preserve",
					)
					editor.dispatchEvent(new Event("input"))
					editor.focus()
				}
			}
			for (let match of line.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
				let token = (match[1] ?? "").split("|")[0] ?? ""
				let doc = options
					.documents()
					.find(doc => doc.id === token || doc.title === token)
				if (doc)
					action(
						translate("Open document") + ": " + doc.title,
						"external-link",
					).onclick = () => options.openDocument(doc.id)
			}
			for (let match of line.matchAll(/https?:\/\/[^\s<>\)\]]+/g)) {
				let url = safeUrl(match[0])
				if (!url) continue
				let link = document.createElement("a")
				link.href = url
				link.target = "_blank"
				link.rel = "noopener noreferrer"
				setMarkup(link, icon("external-link"))
				link.title = translate("Open link") + ": " + url
				link.setAttribute("aria-label", link.title)
				toolbar.append(link)
			}
			let image = /!\[[^\]]*\]\([^)]*\)/.exec(line)
			let drawingId = image?.[0].match(/\(asset:([\w-]+)\)/)?.[1]
			if (drawingId && options.isDrawing(drawingId))
				action("Edit drawing", "pencil").onclick = () =>
					options.openDrawing(drawingId)
			if (image && !editor.readOnly) {
				let offset = start + image.index,
					length = image[0].length
				action("Replace image", "image-plus").onclick = () => {
					editor.focus()
					editor.setSelectionRange(offset, offset + length)
					options.requestAsset()
				}
			}
		}
		visibility(document.activeElement)
	}
	function action(label: string, name: IconName) {
		let button = document.createElement("button")
		button.type = "button"
		setMarkup(button, icon(name))
		button.title = translate(label)
		button.setAttribute("aria-label", button.title)
		toolbar.append(button)
		return button
	}
	function position() {
		if (!viewport || !touch) return
		baselineHeight = Math.max(baselineHeight, viewportHeight())
		let keyboard =
			baselineHeight - viewport.height >= 80 &&
			baselineHeight - viewport.height - viewport.offsetTop > 0
		let inset = Math.max(
			0,
			document.documentElement.clientHeight -
				viewport.height -
				viewport.offsetTop,
		)
		let accessory = viewport.offsetTop > 0 ? 8 : 72
		toolbar.style.setProperty(
			"--floating-bottom",
			(keyboard ? inset + accessory : 16) + "px",
		)
		toolbar.toggleAttribute("data-keyboard", keyboard)
	}
	function resetViewport() {
		baselineHeight = viewportHeight()
		schedulePosition()
	}
	function schedulePosition() {
		cancelAnimationFrame(frame)
		frame = requestAnimationFrame(position)
	}
	function viewportHeight() {
		return Math.max(
			innerHeight,
			document.documentElement.clientHeight,
			viewport?.height ?? 0,
		)
	}
	function focusChanged(event: Event) {
		visibility(
			event instanceof FocusEvent && event.type === "focusout"
				? event.relatedTarget
				: document.activeElement,
		)
	}
	function visibility(target: EventTarget | null) {
		toolbar.hidden =
			editor.readOnly ||
			!toolbar.childElementCount ||
			(target !== editor.element &&
				!(target instanceof Node && toolbar.contains(target)))
	}
}
