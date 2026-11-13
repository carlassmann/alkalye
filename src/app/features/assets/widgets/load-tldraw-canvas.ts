export { loadTldrawCanvas }

// tldraw is large and reads Astro's client env, so callers load it on demand.
function loadTldrawCanvas() {
	return import("./tldraw-canvas")
}
