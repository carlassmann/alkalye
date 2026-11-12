export { forwardWheel }

// Some browsers send the wheel over the demo's pinned app layers nowhere,
// so the page scroll that drives the demo is passed on by hand.
function forwardWheel(target: EventTarget, scroll: (deltaY: number) => void) {
	function handleWheel(event: Event) {
		if (!(event instanceof WheelEvent)) return
		if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
		event.preventDefault()
		scroll(
			event.deltaMode === WheelEvent.DOM_DELTA_LINE
				? event.deltaY * 16
				: event.deltaY,
		)
	}
	target.addEventListener("wheel", handleWheel, { passive: false })
	return () => target.removeEventListener("wheel", handleWheel)
}
