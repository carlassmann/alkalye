import { type RefObject, useEffect, useState } from "react"
import { isTouchDevice } from "@/app/lib/platform"

export { useScreenKeyboardBottomInset, useScreenKeyboardFloatingBottomOffset }

let screenKeyboardBottomInsetProperty = "--screen-keyboard-bottom-inset"
let screenKeyboardTopOffsetProperty = "--screen-keyboard-top-offset"
let screenKeyboardSettlingAttribute = "data-screen-keyboard-settling"
let keyboardInsetThreshold = 80
// Outlasts the window scroll iOS animates when the keyboard opens.
let keyboardScrollSettleDelay = 300
let floatingBottomOffset = 16
let floatingKeyboardAccessoryOffset = 8
let floatingKeyboardOverlayAccessoryOffset = 72
let lastKeyboardInsetLog = ""

function useScreenKeyboardBottomInset(
	containerRef: RefObject<HTMLElement | null>,
) {
	useEffect(() => {
		let maybeViewport = window.visualViewport
		let maybeEditor = containerRef.current?.closest(".markdown-editor")
		if (
			!(maybeEditor instanceof HTMLElement) ||
			!maybeViewport ||
			!isTouchDevice()
		) {
			return
		}

		let viewport = maybeViewport
		let editor = maybeEditor
		let root = document.documentElement
		let baselineHeight = getViewportHeight(viewport)
		let frame = 0
		let settleTimer = 0

		function updateInset() {
			if (root.hasAttribute(screenKeyboardSettlingAttribute)) {
				// The viewport reports the reset window scroll a few frames late.
				if (viewport.offsetTop > 0) return
				requestAnimationFrame(finishSettling)
			}
			baselineHeight = Math.max(baselineHeight, getViewportHeight(viewport))

			let viewportOffset = getViewportOffset(viewport, baselineHeight)

			setViewportOffset(root, viewportOffset)
			logKeyboardInset("scroll", viewport, baselineHeight, viewportOffset)

			clearTimeout(settleTimer)
			if (viewportOffset.topOffset > 0) {
				settleTimer = window.setTimeout(
					moveWindowScrollIntoEditor,
					keyboardScrollSettleDelay,
				)
			}
		}

		// iOS reveals a caret behind the keyboard by scrolling the window, which
		// slides the whole editor up. Once that animation has finished, the
		// scroll moves into the editor's own scroller in a single frame, so the
		// text does not move and the window has nothing to animate back on close.
		function moveWindowScrollIntoEditor() {
			let scroller = editor.querySelector(".cm-scroller")
			if (
				!scroller ||
				viewport.scale !== 1 ||
				!editor.contains(document.activeElement)
			) {
				return
			}
			let windowScroll = window.scrollY
			root.setAttribute(screenKeyboardSettlingAttribute, "")
			window.scrollTo(0, 0)
			// The viewport reports the reset scroll only a few frames later.
			setViewportOffset(root, getViewportOffset(viewport, baselineHeight, 0))
			scroller.scrollTop += windowScroll
			settleTimer = window.setTimeout(finishSettling, keyboardScrollSettleDelay)
		}

		function finishSettling() {
			if (!root.hasAttribute(screenKeyboardSettlingAttribute)) return
			root.removeAttribute(screenKeyboardSettlingAttribute)
			scheduleUpdate()
		}

		function scheduleUpdate() {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(updateInset)
		}

		function resetBaseline() {
			baselineHeight = getViewportHeight(viewport)
			scheduleUpdate()
		}

		// iOS reports the viewport only after the keyboard has finished hiding.
		// Starting the reset on blur moves the toolbar and editor along with it.
		function resetTopOffsetWhenKeyboardHides(event: FocusEvent) {
			if (isEditableElement(event.relatedTarget)) return
			root.style.setProperty(screenKeyboardTopOffsetProperty, "0px")
		}

		updateInset()
		viewport.addEventListener("resize", scheduleUpdate)
		viewport.addEventListener("scroll", scheduleUpdate)
		window.addEventListener("orientationchange", resetBaseline)
		editor.addEventListener("focusout", resetTopOffsetWhenKeyboardHides)
		// Focus can leave and return without the viewport changing, so no
		// viewport event would restore the offset cleared on blur.
		editor.addEventListener("focusin", scheduleUpdate)

		return () => {
			cancelAnimationFrame(frame)
			clearTimeout(settleTimer)
			root.removeAttribute(screenKeyboardSettlingAttribute)
			viewport.removeEventListener("resize", scheduleUpdate)
			viewport.removeEventListener("scroll", scheduleUpdate)
			window.removeEventListener("orientationchange", resetBaseline)
			editor.removeEventListener("focusout", resetTopOffsetWhenKeyboardHides)
			editor.removeEventListener("focusin", scheduleUpdate)
			removeViewportOffset(root)
		}
	}, [containerRef])
}

function useScreenKeyboardFloatingBottomOffset() {
	let [floatingOffset, setFloatingOffset] = useState({
		bottomOffset: floatingBottomOffset,
		screenKeyboardOpen: false,
	})

	useEffect(() => {
		let maybeViewport = window.visualViewport
		if (!maybeViewport || !isTouchDevice()) return

		let viewport = maybeViewport
		let baselineHeight = getViewportHeight(viewport)
		let frame = 0

		function updateOffset() {
			baselineHeight = Math.max(baselineHeight, getViewportHeight(viewport))

			let viewportOffset = getViewportOffset(viewport, baselineHeight)
			let screenKeyboardOpen = viewportOffset.bottomInset > 0
			let keyboardAccessoryOffset =
				viewportOffset.topOffset > 0
					? floatingKeyboardAccessoryOffset
					: floatingKeyboardOverlayAccessoryOffset
			let bottomOffset = screenKeyboardOpen
				? viewportOffset.fixedBottomInset + keyboardAccessoryOffset
				: floatingBottomOffset

			setFloatingOffset({ bottomOffset, screenKeyboardOpen })
			logKeyboardInset("floating", viewport, baselineHeight, viewportOffset, {
				bottomOffset,
				keyboardAccessoryOffset,
				screenKeyboardOpen,
			})
		}

		function scheduleUpdate() {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(updateOffset)
		}

		function resetBaseline() {
			baselineHeight = getViewportHeight(viewport)
			scheduleUpdate()
		}

		updateOffset()
		viewport.addEventListener("resize", scheduleUpdate)
		viewport.addEventListener("scroll", scheduleUpdate)
		window.addEventListener("orientationchange", resetBaseline)

		return () => {
			cancelAnimationFrame(frame)
			viewport.removeEventListener("resize", scheduleUpdate)
			viewport.removeEventListener("scroll", scheduleUpdate)
			window.removeEventListener("orientationchange", resetBaseline)
		}
	}, [])

	return floatingOffset
}

interface ViewportOffset {
	topOffset: number
	bottomInset: number
	fixedBottomInset: number
	heightReduction: number
}

function getViewportOffset(
	viewport: VisualViewport,
	baselineHeight: number,
	viewportTop = viewport.offsetTop,
): ViewportOffset {
	let topOffset = Math.max(0, viewportTop)
	let heightReduction = Math.max(0, baselineHeight - viewport.height)
	let bottomInset = Math.max(0, baselineHeight - viewport.height - topOffset)
	let fixedBottomInset = Math.max(
		0,
		document.documentElement.clientHeight - viewport.height - topOffset,
	)

	if (heightReduction < keyboardInsetThreshold) {
		return {
			topOffset: 0,
			bottomInset: 0,
			fixedBottomInset: 0,
			heightReduction,
		}
	}

	return { topOffset, bottomInset, fixedBottomInset, heightReduction }
}

function setViewportOffset(root: HTMLElement, viewportOffset: ViewportOffset) {
	root.style.setProperty(
		screenKeyboardTopOffsetProperty,
		`${viewportOffset.topOffset}px`,
	)
	root.style.setProperty(
		screenKeyboardBottomInsetProperty,
		`${viewportOffset.bottomInset}px`,
	)
}

function removeViewportOffset(root: HTMLElement) {
	root.style.removeProperty(screenKeyboardTopOffsetProperty)
	root.style.removeProperty(screenKeyboardBottomInsetProperty)
}

function isEditableElement(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false
	return target.isContentEditable || target.matches("input, textarea, select")
}

function getViewportHeight(viewport: VisualViewport) {
	return Math.max(
		document.documentElement.clientHeight,
		window.innerHeight,
		viewport.height,
	)
}

function logKeyboardInset(
	event: "scroll" | "floating",
	viewport: VisualViewport,
	baselineHeight: number,
	viewportOffset: ViewportOffset,
	extra: Record<string, boolean | number> = {},
) {
	let snapshot = {
		event,
		baselineHeight,
		heightReduction: viewportOffset.heightReduction,
		visualViewportHeight: viewport.height,
		visualViewportTop: viewportOffset.topOffset,
		innerHeight: window.innerHeight,
		clientHeight: document.documentElement.clientHeight,
		bottomInset: viewportOffset.bottomInset,
		fixedBottomInset: viewportOffset.fixedBottomInset,
		...extra,
	}
	let serialized = JSON.stringify(snapshot)
	if (serialized === lastKeyboardInsetLog) return
	lastKeyboardInsetLog = serialized
	console.info("[alkalye:screen-keyboard]", snapshot)
}
