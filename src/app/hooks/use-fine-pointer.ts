import { useSyncExternalStore } from "react"

export { useHasFinePointer }

let finePointerQuery = "(any-pointer: fine)"

function useHasFinePointer() {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function getSnapshot() {
	return window.matchMedia(finePointerQuery).matches
}

function getServerSnapshot() {
	return false
}

function subscribe(callback: () => void) {
	let mediaQuery = window.matchMedia(finePointerQuery)
	mediaQuery.addEventListener("change", callback)
	return () => mediaQuery.removeEventListener("change", callback)
}
