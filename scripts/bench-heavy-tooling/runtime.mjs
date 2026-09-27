/* global setTimeout */
import { writeFileSync } from "node:fs"
import { browser, connect } from "./cdp.mjs"

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
		await new Promise(resolve => setTimeout(resolve, 20))
	}
}
let url = await evaluate("location.origin+location.pathname")
let original = await evaluate(
	"document.querySelector('.cm-content').cmTile.view.state.doc.toString()",
)
let results = {}
try {
	await cdp.command("Network.enable")
	await cdp.command("Network.setBypassServiceWorker", { bypass: false })
	await cdp.command("Network.emulateNetworkConditions", {
		offline: true,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	})
	browser("open", url)
	await wait(
		"(() => {let e=document.querySelector('.cm-content'),r=e?.getBoundingClientRect();return r&&e.contains(document.elementFromPoint(r.x+20,r.y+20))})()",
	)
	browser("focus", ".cm-content")
	browser("keyboard", "inserttext", "OFFLINE_HEAVY_CHECK")
	results.offlineEdit = await evaluate(
		"document.querySelector('.cm-content').textContent.includes('OFFLINE_HEAVY_CHECK') && !!navigator.serviceWorker.controller",
	)
	browser("press", "Meta+z")
	await cdp.command("Network.emulateNetworkConditions", {
		offline: false,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	})
	await cdp.command("Network.setBypassServiceWorker", { bypass: true })
	await cdp.command("Network.setBlockedURLs", {
		urls: ["*syntax-highlighter*"],
	})
	browser("open", url)
	await wait("document.querySelector('.cm-content')")
	browser("focus", ".cm-content")
	browser("press", "Meta+a")
	browser(
		"keyboard",
		"inserttext",
		"# Heavy fallback fixture\n\n```js\nconst answer = 42\n```\n",
	)
	await evaluate("document.querySelector('[aria-label=Preview]').click()")
	await wait(
		"document.querySelector('pre code')?.textContent.includes('answer')",
	)
	await new Promise(resolve => setTimeout(resolve, 500))
	results.failedHighlighterReadable = await evaluate(
		"!document.querySelector('pre.shiki') && document.querySelector('pre code').textContent.includes('answer') && document.querySelector('pre').getBoundingClientRect().width>0",
	)
	await cdp.command("Network.setBlockedURLs", { urls: [] })
	browser("open", url)
	await wait("document.querySelector('.cm-content')")
	await evaluate("document.querySelector('[aria-label=Preview]').click()")
	await wait("document.querySelector('pre.shiki span[style]')")
	results.highlighterRecovers = true
	if (Object.values(results).some(value => !value))
		throw new Error(JSON.stringify(results))
	writeFileSync(
		"/tmp/alkalye-heavy/runtime.json",
		JSON.stringify(results, null, 2),
	)
} finally {
	await cdp.command("Network.setBlockedURLs", { urls: [] })
	await cdp.command("Network.emulateNetworkConditions", {
		offline: false,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	})
	browser("open", url)
	await wait("document.querySelector('.cm-content')")
	browser("focus", ".cm-content")
	browser("press", "Meta+a")
	browser("keyboard", "inserttext", original)
	cdp.close()
}
