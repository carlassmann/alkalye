import console from "node:console"
/* global setTimeout */
import { writeFileSync } from "node:fs"
import process from "node:process"
import { browser, connect } from "./cdp.mjs"

let label = process.argv[2] ?? "baseline"
let offline = process.argv.includes("--offline")
let cdp = await connect()
await cdp.rootCommand("Browser.setDownloadBehavior", {
	behavior: "allow",
	downloadPath: "/tmp/alkalye-heavy/downloads",
})
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
let url = await evaluate("location.origin + location.pathname")
let original = await evaluate(
	"document.querySelector('.cm-content').cmTile.view.state.doc.toString()",
)
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
	browser("focus", ".cm-content")
	browser("press", "Meta+a")
	browser(
		"keyboard",
		"inserttext",
		"# Heavy feature fixture\n\n```ts\nconst answer: number = 42\n```\n",
	)
	await new Promise(resolve => setTimeout(resolve, 500))
	for (let run = 1; run <= (offline ? 1 : 7); run++) {
		browser("open", url)
		await wait(
			"document.querySelector('.cm-content')?.textContent.includes('Heavy feature fixture')",
		)
		await wait(
			"(() => {let e=document.querySelector('.cm-content'),r=e?.getBoundingClientRect();return r&&e.contains(document.elementFromPoint(r.x+20,r.y+20))})()",
		)
		await evaluate(
			`window.__featureStart = performance.now(); document.querySelector('[aria-label=Preview]').click()`,
		)
		await wait("document.querySelector('pre.shiki span[style]')")
		rows.push(
			await evaluate(
				`({feature:'syntax',run:${run},ms:performance.now()-window.__featureStart,correct:document.querySelector('pre.shiki').textContent.includes('answer'),resources:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js')).map(r=>r.name.split('/').pop())})`,
			),
		)
		console.log(rows.at(-1))
		writeFileSync(
			`/tmp/alkalye-heavy/${label}-features.json`,
			JSON.stringify(rows, null, 2),
		)
	}
	for (let run = 1; run <= (offline ? 1 : 7); run++) {
		browser("open", url)
		await wait("document.querySelector('.cm-content')")
		await evaluate(
			`document.querySelector('[aria-label="File options"]').click()`,
		)
		await wait(
			"Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent.includes('Export'))",
		)
		await evaluate(
			`window.__download = null; let originalCreate = URL.createObjectURL; URL.createObjectURL = function(blob){ if(blob.type.includes('zip')) window.__download={ms:performance.now()-window.__featureStart,size:blob.size}; return originalCreate.call(this,blob) }; window.__featureStart=performance.now(); Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent.includes('Export')).click()`,
		)
		await wait("window.__download")
		rows.push(
			await evaluate(
				`({feature:'zip-export',run:${run},...window.__download,resources:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js')).map(r=>r.name.split('/').pop())})`,
			),
		)
		console.log(rows.at(-1))
		writeFileSync(
			`/tmp/alkalye-heavy/${label}-features.json`,
			JSON.stringify(rows, null, 2),
		)
	}
	writeFileSync(
		`/tmp/alkalye-heavy/${label}-features.json`,
		JSON.stringify(rows, null, 2),
	)
} finally {
	browser("open", url)
	await wait("document.querySelector('.cm-content')")
	browser("focus", ".cm-content")
	browser("press", "Meta+a")
	browser("keyboard", "inserttext", original)
	await cdp.command("Network.emulateNetworkConditions", {
		offline: false,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	})
	cdp.close()
}
