import console from "node:console"
import { URL } from "node:url"
/* global setTimeout */
import { readFileSync, writeFileSync } from "node:fs"
import process from "node:process"
import { browser, connect } from "./cdp.mjs"

let [label = "baseline", target, output = `/tmp/alkalye-heavy/${label}.json`] =
	process.argv.slice(2)
if (!target) throw new Error("Pass label and full document URL")
let cdp = await connect()
await cdp.command("Page.enable")
let observe = readFileSync(new URL("observe.js", import.meta.url), "utf8")
await cdp.command("Page.addScriptToEvaluateOnNewDocument", { source: observe })
await cdp.command("Network.enable")
let results = []
async function evaluate(expression) {
	let response = await cdp.command("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true,
	})
	if (response.exceptionDetails)
		throw new Error(JSON.stringify(response.exceptionDetails))
	return response.result.value
}
try {
	for (let cpu of [1, 4]) {
		await cdp.command("Emulation.setCPUThrottlingRate", { rate: cpu })
		for (let mode of ["cold-http", "cached-http", "service-worker"]) {
			await cdp.command("Network.setBypassServiceWorker", {
				bypass: mode !== "service-worker",
			})
			for (let run = 1; run <= 7; run++) {
				if (mode === "cold-http") await cdp.command("Network.clearBrowserCache")
				browser("open", target)
				let started = Date.now()
				while (!(await evaluate("window.__heavy?.uncovered"))) {
					if (Date.now() - started > 30000)
						throw new Error("Editor never became usable")
					await new Promise(resolve => setTimeout(resolve, 20))
				}
				let marker = `HEAVY_${label}_${cpu}_${mode}_${run}`
				browser("click", '.cm-content[contenteditable="true"]')
				browser("focus", ".cm-content")
				browser("press", "Meta+ArrowDown")
				browser("keyboard", "inserttext", marker)
				let data = await evaluate(
					`({ ...window.__heavy, interactive: performance.now(), edited: document.querySelector('.cm-content').textContent.includes(${JSON.stringify(marker)}), url: location.pathname, controlled: !!navigator.serviceWorker.controller, resources: performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js')).map(r=>({name:r.name.split('/').pop(),encoded:r.encodedBodySize,decoded:r.decodedBodySize,transfer:r.transferSize})) })`,
				)
				if (!data.edited) throw new Error("Edit did not appear")
				results.push({ cpu, mode, run, ...data })
				browser("press", "Meta+z")
				await new Promise(resolve => setTimeout(resolve, 300))
				console.log(
					label,
					cpu,
					mode,
					run,
					Math.round(data.ready),
					Math.round(data.uncovered),
					Math.round(data.interactive),
				)
				writeFileSync(output, JSON.stringify(results, null, 2))
			}
		}
	}
} finally {
	await cdp.command("Emulation.setCPUThrottlingRate", { rate: 1 })
	cdp.close()
}
