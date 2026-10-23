import { EditorView, ViewPlugin } from "@codemirror/view"
import { type Extension } from "@codemirror/state"
import { isTouchDevice } from "@/app/lib/platform"

export {
	screenKeyboardScrolling,
	getScreenKeyboardScrollMargins,
	getCaretRevealDelta,
	viewportChangeMayHideCaret,
}

let comfortableBottomMarginRatio = 0.3
let keyboardTransitionProperties = new Set(["top", "padding-bottom"])
let maxKeyboardTransitionWait = 400

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

function getCaretRevealDelta(
	caret: { top: number; bottom: number },
	visibleTop: number,
	visibleBottom: number,
) {
	if (caret.top < visibleTop) return caret.top - visibleTop
	if (caret.bottom > visibleBottom) return caret.bottom - visibleBottom
	return 0
}

function measureCaretRevealScrollTop(view: EditorView) {
	let caret = view.coordsAtPos(view.state.selection.main.head)
	if (!caret) return null
	let scroller = view.scrollDOM.getBoundingClientRect()
	let margins = getScreenKeyboardScrollMargins(
		scroller.bottom,
		view.scrollDOM.clientHeight,
		window.visualViewport?.height ?? window.innerHeight,
	)
	let delta = getCaretRevealDelta(
		caret,
		scroller.top,
		scroller.bottom - margins.bottom,
	)
	return delta === 0 ? null : view.scrollDOM.scrollTop + delta
}

// The editor offset and the keyboard padding animate after the viewport
// changes. Measuring mid-transition reads moving geometry.
function waitForKeyboardTransitions(view: EditorView) {
	let editor = view.dom.closest(".markdown-editor") ?? view.dom
	let transitions = editor
		.getAnimations({ subtree: true })
		.filter(
			animation =>
				animation instanceof CSSTransition &&
				keyboardTransitionProperties.has(animation.transitionProperty),
		)
		.map(transition => transition.finished.catch(() => undefined))
	let timeout = new Promise(resolve =>
		setTimeout(resolve, maxKeyboardTransitionWait),
	)
	return Promise.race([Promise.all(transitions), timeout])
}

function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

let screenKeyboardScrollMargins = EditorView.scrollMargins.of(view =>
	getScreenKeyboardScrollMargins(
		view.scrollDOM.getBoundingClientRect().bottom,
		view.scrollDOM.clientHeight,
		window.visualViewport?.height ?? window.innerHeight,
	),
)

// Only a shrinking viewport or a window scrolled further down can cover the
// caret. Growing viewports, the window scrolling back up and pinch-zoom
// panning must not yank the user's scroll position.
function viewportChangeMayHideCaret(
	previous: ViewportGeometry,
	next: ViewportGeometry,
) {
	if (next.scale !== 1) return false
	return next.height < previous.height || next.offsetTop > previous.offsetTop
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
		revealRequest = 0
		revealPending = false

		constructor(view: EditorView) {
			this.view = view
			if (!this.viewport || !isTouchDevice()) return
			this.viewport.addEventListener("resize", this.scheduleReveal)
			this.viewport.addEventListener("scroll", this.scheduleReveal)
			view.scrollDOM.addEventListener("touchstart", this.cancelReveal, {
				passive: true,
			})
		}

		// A pending reveal must never override a user who has started scrolling.
		cancelReveal = () => {
			this.revealPending = false
			cancelAnimationFrame(this.frame)
			this.revealRequest += 1
		}

		// Waits two frames so the keyboard offset CSS variables have been
		// applied and laid out before the caret position is measured.
		scheduleReveal = () => {
			if (!this.viewport || !this.geometry) return
			let previous = this.geometry
			this.geometry = readViewportGeometry(this.viewport)
			if (viewportChangeMayHideCaret(previous, this.geometry)) {
				this.revealPending = true
			}
			// While iOS keeps the window scrolled, its own scroll is revealing the
			// caret. Gliding the editor at the same time would fight it, so the
			// reveal waits until the window scroll has moved into the editor.
			if (!this.revealPending || window.scrollY > 0) return
			this.cancelReveal()
			let request = this.revealRequest
			this.frame = requestAnimationFrame(() => {
				this.frame = requestAnimationFrame(async () => {
					await waitForKeyboardTransitions(this.view)
					if (!this.isCurrent(request)) return
					// iOS may only now have started its own window scroll.
					if (window.scrollY > 0) this.revealPending = true
					else this.revealCaret(request)
				})
			})
		}

		isCurrent(request: number) {
			return (
				request === this.revealRequest &&
				this.view.hasFocus &&
				this.viewport?.scale === 1
			)
		}

		// Glides instead of jumping, like native text views do above the keyboard.
		revealCaret(request: number) {
			this.view.requestMeasure({
				key: this,
				read: view =>
					this.isCurrent(request) ? measureCaretRevealScrollTop(view) : null,
				write: top => {
					if (top === null || !this.isCurrent(request)) return
					this.view.scrollDOM.scrollTo({
						top,
						behavior: prefersReducedMotion() ? "auto" : "smooth",
					})
				},
			})
		}

		destroy() {
			this.cancelReveal()
			this.viewport?.removeEventListener("resize", this.scheduleReveal)
			this.viewport?.removeEventListener("scroll", this.scheduleReveal)
			this.view.scrollDOM.removeEventListener("touchstart", this.cancelReveal)
		}
	},
)

let screenKeyboardScrolling: Extension = [
	screenKeyboardScrollMargins,
	revealCaretOnViewportChange,
]
