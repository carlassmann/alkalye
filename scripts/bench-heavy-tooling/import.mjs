/* global setTimeout */
import JSZip from "jszip"
import { writeFileSync } from "node:fs"
import process from "node:process"
import { browser, connect } from "./cdp.mjs"

let label = process.argv[2] ?? "baseline"
let offline = process.argv.includes("--offline")
let zip = new JSZip()
zip.file(
	"Heavy import fixture.md",
	"# Heavy import fixture\n\nArchive import payload.\n",
)
writeFileSync(
	"/tmp/alkalye-heavy/import.zip",
	await zip.generateAsync({ type: "uint8array" }),
)
let cdp = await connect()
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
	await cdp.command("Network.setBypassServiceWorker", { bypass: !offline })
	if (offline)
		await cdp.command("Network.emulateNetworkConditions", {
			offline: true,
			latency: 0,
			downloadThroughput: -1,
			uploadThroughput: -1,
		})
	for (let run = 1; run <= (offline ? 1 : 7); run++) {
		browser("open", url)
		await wait(
			"(() => {let e=document.querySelector('.cm-content'),r=e?.getBoundingClientRect();return r&&e.contains(document.elementFromPoint(r.x+20,r.y+20))})()",
		)
		await evaluate(
			`document.querySelector('input[accept*=".zip"]').addEventListener('change',()=>{window.__importStart=performance.now()},{once:true})`,
		)
		browser("upload", 'input[accept*=".zip"]', "/tmp/alkalye-heavy/import.zip")
		await wait(
			`document.querySelector('[data-doc-title="Heavy import fixture"] a')`,
		)
		let imported = await evaluate(
			`({run:${run},ms:performance.now()-window.__importStart,resources:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js')).map(r=>r.name.split('/').pop())})`,
		)
		await evaluate(
			`document.querySelector('[data-doc-title="Heavy import fixture"] a').click()`,
		)
		await wait(
			`document.querySelector('.cm-content')?.textContent.includes('Archive import payload.')`,
		)
		imported.correct = true
		await new Promise(resolve => setTimeout(resolve, 500))
		rows.push(imported)
		await evaluate(
			`document.querySelector('[data-testid="doc-file-menu-button"]').click()`,
		)
		await wait(`document.querySelector('[data-testid="doc-delete-button"]')`)
		await evaluate(
			`document.querySelector('[data-testid="doc-delete-button"]').click()`,
		)
		await wait(
			`document.querySelector('[data-testid="dialog-delete-confirm"]')`,
		)
		await evaluate(
			`document.querySelector('[data-testid="dialog-delete-confirm"]').click()`,
		)
		await wait(
			`!document.querySelector('[data-doc-title="Heavy import fixture"]')`,
		)
		writeFileSync(
			`/tmp/alkalye-heavy/${label}-import.json`,
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
	browser("open", url)
	cdp.close()
}
