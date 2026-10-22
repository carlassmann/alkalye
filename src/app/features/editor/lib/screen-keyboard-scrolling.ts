import { EditorView, ViewPlugin } from "@codemirror/view"
import { type Extension } from "@codemirror/state"
import { isTouchDevice } from "@/app/lib/platform"

export {
	screenKeyboardScrolling,
	getScreenKeyboardScrollMargins,
	viewportChangeMayHideCaret,
}

let comfortableBottomMarginRatio = 0.3

interface ViewportGeometry {
	height: number
	offsetTop: number
	scale: number
}

// The scroller extends under the screen keyboard, so CodeMirror would treat
// lines behind the keyboard as visible and never scroll them into view.
function getScreenKeyboardScrollMargins(
	scrollerBottom: number,
	scrollerHeight: number,
	visibleBottom: number,
) {
	let keyboardOverlap = Math.max(0, scrollerBottom - visibleBottom)
	let visibleHeight = Math.max(0, scrollerHeight - keyboardOverlap)
	return {
		bottom: keyboardOverlap + visibleHeight * comfortableBottomMarginRatio,
	}
}

let screenKeyboardScrollMargins = EditorView.scrollMargins.of(view =>
	getScreenKeyboardScrollMargins(
		view.scrollDOM.getBoundingClientRect().bottom,
		view.scrollDOM.clientHeight,
		window.visualViewport?.height ?? window.innerHeight,
	),
)

// Only a shrinking or shifting viewport can cover the caret. Growing
// viewports and pinch-zoom panning must not yank the user's scroll position.
function viewportChangeMayHideCaret(
	previous: ViewportGeometry,
	next: ViewportGeometry,
) {
	if (next.scale !== 1) return false
	return next.height < previous.height || next.offsetTop !== previous.offsetTop
}

function readViewportGeometry(viewport: VisualViewport): ViewportGeometry {
	return {
		height: viewport.height,
		offsetTop: viewport.offsetTop,
		scale: viewport.scale,
	}
}

// Opening the keyboard resizes and scrolls the visual viewport without any
// editor update, so the caret can end up behind the keyboard or the toolbar.
let revealCaretOnViewportChange = ViewPlugin.fromClass(
	class {
		view: EditorView
		viewport = window.visualViewport
		geometry = this.viewport && readViewportGeometry(this.viewport)
		frame = 0

		constructor(view: EditorView) {
			this.view = view
			if (!this.viewport || !isTouchDevice()) return
			this.viewport.addEventListener("resize", this.scheduleReveal)
			this.viewport.addEventListener("scroll", this.scheduleReveal)
		}

		// Waits two frames so the keyboard offset CSS variables have been
		// applied and laid out before the caret position is measured.
		scheduleReveal = () => {
			if (!this.viewport || !this.geometry) return
			let previous = this.geometry
			this.geometry = readViewportGeometry(this.viewport)
			if (!viewportChangeMayHideCaret(previous, this.geometry)) return
			cancelAnimationFrame(this.frame)
			this.frame = requestAnimationFrame(() => {
				this.frame = requestAnimationFrame(() => this.revealCaret())
			})
		}

		revealCaret() {
			if (!this.view.hasFocus) return
			this.view.dispatch({
				effects: EditorView.scrollIntoView(this.view.state.selection.main.head),
			})
		}

		destroy() {
			cancelAnimationFrame(this.frame)
			this.viewport?.removeEventListener("resize", this.scheduleReveal)
			this.viewport?.removeEventListener("scroll", this.scheduleReveal)
		}
	},
)

let screenKeyboardScrolling: Extension = [
	screenKeyboardScrollMargins,
	revealCaretOnViewportChange,
]
