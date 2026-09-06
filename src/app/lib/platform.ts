import { useSyncExternalStore } from "react"

export {
	isMac,
	modKey,
	altModKey,
	isTouchDevice,
	isAndroid,
	isIOS,
	isApplePlatform,
	isMobileDevice,
	useIsPWAInstalled,
	getPWAInstalledSnapshot,
}

let isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent)

let modKey = isMac ? "⌘" : "Ctrl+"
let altModKey = isMac ? "⌥⌘" : "Ctrl+Alt+"

function isTouchDevice(): boolean {
	return (
		typeof window !== "undefined" &&
		("ontouchstart" in window || navigator.maxTouchPoints > 0)
	)
}

function isAndroid(): boolean {
	return navigator.userAgent.toLowerCase().includes("android")
}

function isIOS(): boolean {
	return /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
}

function isApplePlatform(
	userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
	return /mac|iphone|ipad|ipod/i.test(userAgent)
}

function isMobileDevice(): boolean {
	let userAgent = navigator.userAgent.toLowerCase()
	let isMobile =
		/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
			userAgent,
		)
	let hasTouchScreen = "ontouchstart" in window || navigator.maxTouchPoints > 0
	return isMobile || hasTouchScreen
}

function useIsPWAInstalled(): boolean {
	return useSyncExternalStore(
		subscribeToPWAInstalled,
		getPWAInstalledSnapshot,
		() => false,
	)
}

function getPWAInstalledSnapshot() {
	let isStandalone = window.matchMedia("(display-mode: standalone)").matches
	let isIOSStandalone =
		(window.navigator as unknown as { standalone: boolean }).standalone === true
	return isStandalone || isIOSStandalone
}

function subscribeToPWAInstalled(callback: () => void) {
	let mediaQuery = window.matchMedia("(display-mode: standalone)")
	mediaQuery.addEventListener("change", callback)
	return () => mediaQuery.removeEventListener("change", callback)
}
