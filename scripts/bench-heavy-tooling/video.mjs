import console from "node:console"
/* global setTimeout */
import { writeFileSync } from "node:fs"
import process from "node:process"
import { browser, connect } from "./cdp.mjs"

let label = process.argv[2] ?? "baseline"
let offline = process.argv.includes("--offline")
let cdp = await connect()
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
async function wait(expression) {
	let start = Date.now()
	while (!(await evaluate(`Boolean(${expression})`))) {
		if (Date.now() - start > 30000) throw new Error(`Timed out: ${expression}`)
		await new Promise(resolve => setTimeout(resolve, 10))
	}
}
let url = await evaluate("location.origin+location.pathname")
let rows = []
try {
	await cdp.command("Network.enable")
	if (offline)
		await cdp.command("Network.emulateNetworkConditions", {
			offline: true,
			latency: 0,
			downloadThroughput: -1,
			uploadThroughput: -1,
		})
	await cdp.command("Network.setBypassServiceWorker", { bypass: !offline })
	for (let run = 1; run <= (offline ? 1 : 7); run++) {
		browser("open", url)
		await wait(
			"(() => {let e=document.querySelector('.cm-content'),r=e?.getBoundingClientRect();return r&&e.contains(document.elementFromPoint(r.x+20,r.y+20))})()",
		)
		await evaluate(
			`document.querySelector('input[accept*="video"]').addEventListener('change',()=>{window.__videoStart=performance.now()},{once:true})`,
		)
		browser(
			"upload",
			'input[accept*="video"]',
			"/tmp/alkalye-heavy/heavy-video.mp4",
		)
		await wait(
			"Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='heavy-video')",
		)
		rows.push(
			await evaluate(
				`({run:${run},ms:performance.now()-window.__videoStart,resources:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js')).map(r=>r.name.split('/').pop())})`,
			),
		)
		console.log(rows.at(-1))
		await evaluate(
			`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='heavy-video').click()`,
		)
		await wait(
			"Array.from(document.querySelectorAll('[role=menuitem]')).find(b=>b.textContent==='Delete')",
		)
		await evaluate(
			`Array.from(document.querySelectorAll('[role=menuitem]')).find(b=>b.textContent==='Delete').click()`,
		)
		await wait(
			"!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='heavy-video')",
		)
		writeFileSync(
			`/tmp/alkalye-heavy/${label}-video.json`,
			JSON.stringify(rows, null, 2),
		)
	}
} finally {
	await cdp.command("Network.emulateNetworkConditions", {
		offline: false,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	})
	cdp.close()
}
