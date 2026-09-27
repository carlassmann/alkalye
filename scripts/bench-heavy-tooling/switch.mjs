import { URL } from "node:url"
/* global setTimeout */
import { readFileSync, writeFileSync } from "node:fs"
import process from "node:process"
import { browser, connect } from "./cdp.mjs"

let label = process.argv[2] ?? "baseline"
let cdp = await connect()
let source = readFileSync(new URL("observe.js", import.meta.url), "utf8")
let rows = []
async function evaluate(expression) {
	let response = await cdp.command("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	})
	if (response.exceptionDetails)
		throw new Error(JSON.stringify(response.exceptionDetails))
	return response.result.value
}
try {
	for (let cpu of [1, 4]) {
		await cdp.command("Emulation.setCPUThrottlingRate", { rate: cpu })
		for (let run = 1; run <= 7; run++) {
			let title = run % 2 ? "Heavy fixture 099" : "Heavy fixture 100"
			let probe = source.replace(
				'new URL(location.href).searchParams.get("benchmarkDocument")',
				JSON.stringify(title),
			)
			await evaluate(
				`window.__heavyStart = performance.now(); ${probe}; document.querySelector('[data-doc-title="${title}"] a').click()`,
			)
			let start = Date.now()
			while (!(await evaluate("window.__heavy?.uncovered"))) {
				if (Date.now() - start > 10000)
					throw new Error("Destination editor missing")
				await new Promise(resolve => setTimeout(resolve, 10))
			}
			browser("focus", ".cm-content")
			let marker = `SWITCH_${label}_${cpu}_${run}`
			browser("keyboard", "inserttext", marker)
			let data = await evaluate(
				`({ready:window.__heavy.ready-window.__heavyStart,uncovered:window.__heavy.uncovered-window.__heavyStart,interactive:performance.now()-window.__heavyStart,edited:document.querySelector('.cm-content').textContent.includes(${JSON.stringify(marker)}),destination:document.querySelector('.cm-content').textContent.includes(${JSON.stringify(title)})})`,
			)
			if (!data.edited || !data.destination)
				throw new Error("Destination edit failed")
			rows.push({ cpu, run, ...data })
			browser("press", "Meta+z")
			await new Promise(resolve => setTimeout(resolve, 300))
		}
	}
	writeFileSync(
		`/tmp/alkalye-heavy/${label}-switch.json`,
		JSON.stringify(rows, null, 2),
	)
} finally {
	await cdp.command("Emulation.setCPUThrottlingRate", { rate: 1 })
	cdp.close()
}
