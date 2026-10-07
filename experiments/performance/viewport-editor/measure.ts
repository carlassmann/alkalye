let session = "viewport-editor-experiment"
function browser(...args: string[]) {
	let process = Bun.spawnSync(
		["agent-browser", "--session", session, "--json", ...args],
		{ env: { ...Bun.env, AGENT_BROWSER_HEADED: "false" }, timeout: 60000 },
	)
	let response = JSON.parse(process.stdout.toString())
	if (!response.success) throw Error(process.stdout.toString())
	return response.data.result
}
function evaluate(code: string) {
	return browser("eval", code)
}
let results = []
try {
	for (let size of [131072, 1048576])
		for (let fixture of ["paragraphs", "long"])
			for (let mode of ["bare", "bounded"]) {
				browser("set", "viewport", "1280", "800")
				browser(
					"open",
					`http://127.0.0.1:4331/?size=${size}&fixture=${fixture}&mode=${mode}`,
				)
				browser("wait", "--fn", "Boolean(window.viewportExperiment)")
				evaluate("window.expectedSource=window.viewportExperiment.value")
				let samples = []
				for (let position of [0, size >>> 1, size]) {
					for (let repeat = 0; repeat < 3; repeat++) {
						evaluate(
							`window.viewportExperiment.select(${position});window.viewportExperiment.samples.length=0;window.expectedSource=window.expectedSource.slice(0,${position})+"x"+window.expectedSource.slice(${position})`,
						)
						browser("keyboard", "inserttext", "x")
						browser(
							"wait",
							"--fn",
							"window.viewportExperiment.samples.some(sample=>sample.kind==='insertText'&&sample.frame>0)",
						)
						let result = evaluate(
							"(()=>{let editor=window.viewportExperiment;return {...editor.samples.find(sample=>sample.kind==='insertText'),correct:editor.value===window.expectedSource,position:editor.range.start,nativeCharacters:editor.element.value.length}})()",
						)
						samples.push({ ...result, position })
					}
				}
				evaluate(
					`(() => { let editor=window.viewportExperiment;let target=editor.element.style.overflow==="auto"?editor.element:editor.viewport;target.scrollTop=target.scrollHeight/2 })()`,
				)
				browser(
					"wait",
					"--fn",
					"window.viewportExperiment.samples.some(sample=>sample.kind==='scroll')",
				)
				let scrolling = evaluate(
					"(()=>{let editor=window.viewportExperiment;return {sample:editor.samples.filter(sample=>sample.kind==='scroll').at(-1),nativeCharacters:editor.element.value.length,window:editor.window}})()",
				)
				evaluate(
					"window.viewportExperiment.select(100,105);window.expectedSource=window.expectedSource.slice(0,100)+'replacement'+window.expectedSource.slice(105)",
				)
				browser("keyboard", "inserttext", "replacement")
				browser(
					"wait",
					"--fn",
					"window.viewportExperiment.value===window.expectedSource",
				)
				let selection = evaluate(
					"window.viewportExperiment.range.start===111&&window.viewportExperiment.range.end===111",
				)
				let result = { size, fixture, mode, samples, scrolling, selection }
				results.push(result)
				await Bun.write(
					import.meta.dir + "/results.json",
					JSON.stringify(results, null, 2) + "\n",
				)
				console.log(JSON.stringify(result))
			}
} finally {
	browser("close")
}
