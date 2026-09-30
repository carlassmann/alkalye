import { useSyncExternalStore } from "react"

export { useWidePresentation }

let wideQuery = "(min-width: 768px)"

function useWidePresentation() {
	return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

function getSnapshot() {
	return window.matchMedia(wideQuery).matches
}

function subscribe(onChange: () => void) {
	let query = window.matchMedia(wideQuery)
	query.addEventListener("change", onChange)
	return () => query.removeEventListener("change", onChange)
}
