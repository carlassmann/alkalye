/* global URL, window, document, performance, requestAnimationFrame, location */
window.__heavy = { ready: null, uncovered: null }
function observeEditor() {
	let editor = document.querySelector('.cm-content[contenteditable="true"]')
	let expected = new URL(location.href).searchParams.get("benchmarkDocument")
	if (editor && (!expected || editor.textContent.includes(expected))) {
		let rect = editor.getBoundingClientRect()
		if (rect.width && rect.height) {
			window.__heavy.ready ??= performance.now()
			let hit = document.elementFromPoint(
				rect.x + 20,
				rect.y + Math.min(20, rect.height / 2),
			)
			if (editor.contains(hit)) window.__heavy.uncovered ??= performance.now()
		}
	}
	if (!window.__heavy.uncovered) requestAnimationFrame(observeEditor)
}
requestAnimationFrame(observeEditor)
