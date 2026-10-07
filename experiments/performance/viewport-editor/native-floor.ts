import type { EditorSample } from "./editor"
export class NativeFloorEditor {
	readonly element: HTMLTextAreaElement
	readonly viewport: HTMLTextAreaElement
	readonly samples: EditorSample[] = []
	constructor(host: HTMLElement, source: string) {
		let shell = document.createElement("div")
		shell.className = "viewport"
		shell.dataset.viewportEditor = ""
		this.element = document.createElement("textarea")
		this.viewport = this.element
		this.element.value = source
		this.element.spellcheck = false
		this.element.style.height = "600px"
		this.element.style.overflow = "auto"
		this.element.setAttribute("aria-label", "Bare native textarea control")
		shell.append(this.element)
		host.append(shell)
		let started = 0
		this.element.addEventListener("beforeinput", () => {
			started = performance.now()
		})
		this.element.addEventListener("input", () => {
			let sample = {
				kind: "insertText",
				handler: performance.now() - started,
				frame: 0,
				characters: 0,
			}
			this.samples.push(sample)
			requestAnimationFrame(() => {
				sample.frame = performance.now() - started
			})
		})
		this.element.addEventListener("scroll", () => {
			this.samples.push({ kind: "scroll", handler: 0, frame: 0, characters: 0 })
		})
	}
	get value() {
		return this.element.value
	}
	get range() {
		return {
			start: this.element.selectionStart,
			end: this.element.selectionEnd,
		}
	}
	get window() {
		return { start: 0, end: this.element.value.length, rows: 0 }
	}
	select(start: number, end = start) {
		this.element.focus({ preventScroll: true })
		this.element.setSelectionRange(start, end)
	}
}
