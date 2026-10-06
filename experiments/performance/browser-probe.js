;(() => {
	let state = (window.__benchmark = {
		readyMs: null,
		interactions: [],
		longTasks: [],
		saved: 0,
		lastSaved: null,
		samples: [],
		arm: null,
	})
	window.addEventListener("alkalye:document-saved", event => {
		state.saved++
		state.lastSaved = event.detail
		state.lastSavedAt = performance.now()
	})
	try {
		new PerformanceObserver(list => {
			for (let entry of list.getEntries())
				state.longTasks.push({
					start: entry.startTime,
					duration: entry.duration,
				})
		}).observe({ type: "longtask", buffered: true })
	} catch {}
	try {
		new PerformanceObserver(list => {
			for (let entry of list.getEntries())
				if (entry.interactionId)
					state.interactions.push({
						name: entry.name,
						start: entry.startTime,
						duration: entry.duration,
						processing: entry.processingEnd - entry.processingStart,
						delay: entry.processingStart - entry.startTime,
						id: entry.interactionId,
					})
		}).observe({ type: "event", buffered: true, durationThreshold: 16 })
	} catch {}
	function source() {
		let editor = document.querySelector("alkalye-editor")
		if (editor?.source) return editor.source.value
		let cm = document.querySelector(".cm-editor")
		return (
			cm?.querySelector(".cm-content")?.cmTile?.view?.state.doc.toString() ??
			cm?.querySelector(".cm-content")?.textContent ??
			""
		)
	}
	state.source = source
	function ready() {
		let expected = localStorage.getItem("__benchmarkExpected")
		let editor = document.querySelector("#editor,.cm-editor")
		let valid =
			editor?.checkVisibility() && (!expected || source().includes(expected))
		if (valid && state.readyMs === null)
			requestAnimationFrame(() => {
				state.readyMs = performance.now()
			})
		if (state.readyMs === null) requestAnimationFrame(ready)
	}
	requestAnimationFrame(ready)
	document.addEventListener("pointerdown", begin, true)
	document.addEventListener("keydown", begin, true)
	document.addEventListener("beforeinput", begin, true)
	function begin(event) {
		let arm = state.arm
		if (!arm || arm.started !== undefined) return
		if (!event.isTrusted) return
		arm.started = performance.now()
		requestAnimationFrame(check)
	}
	function check() {
		let arm = state.arm
		if (!arm) return
		let valid = false
		try {
			valid = !!arm.condition()
		} catch {}
		if (valid) {
			requestAnimationFrame(() => {
				if (state.arm !== arm) return
				state.samples.push({
					name: arm.name,
					ms: performance.now() - arm.started,
				})
				state.arm = null
			})
		} else if (performance.now() - arm.started < 30000)
			requestAnimationFrame(check)
		else {
			state.samples.push({ name: arm.name, error: "timeout" })
			state.arm = null
		}
	}
	state.armJourney = (name, condition) => {
		state.arm = { name, condition }
	}
})()
