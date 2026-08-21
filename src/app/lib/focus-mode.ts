export { exitFocusMode, isFocusMode, setFocusMode, toggleFocusMode }

function isFocusMode(): boolean {
	return document.documentElement.dataset.focusMode === "true"
}

function setFocusMode(enabled: boolean) {
	document.documentElement.dataset.focusMode = String(enabled)
}

function toggleFocusMode() {
	setFocusMode(!isFocusMode())
}

function exitFocusMode(): boolean {
	if (!isFocusMode()) return false
	setFocusMode(false)
	return true
}
