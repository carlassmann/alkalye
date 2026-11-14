import { useSyncExternalStore } from "react"
import { useSession } from "jazz-tools/react"

export { markAccountBackedUp, useIsBackedUp }

function markAccountBackedUp(accountId: string) {
	localStorage.setItem("alkalye-recovery-backed-up", accountId)
	window.dispatchEvent(new Event("alkalye:backup-changed"))
}
function subscribe(callback: () => void) {
	window.addEventListener("alkalye:backup-changed", callback)
	window.addEventListener("storage", callback)
	return () => {
		window.removeEventListener("alkalye:backup-changed", callback)
		window.removeEventListener("storage", callback)
	}
}
function snapshot() {
	return localStorage.getItem("alkalye-recovery-backed-up")
}
function useIsBackedUp() {
	let ownerId = useSession()?.user
	return useSyncExternalStore(subscribe, snapshot, () => null) === ownerId
}
