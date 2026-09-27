import process from "node:process"
import console from "node:console"
import { Buffer } from "node:buffer"
import { writeFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"
import { execFileSync } from "node:child_process"
let label = process.argv[2] ?? "baseline",
	cpu = Number(process.argv[3] ?? 1),
	runs = Number(process.argv[4] ?? 12)
function browser(...args) {
	return execFileSync(
		"agent-browser",
		["--session", "sidebar2", "--json", ...args],
		{ encoding: "utf8", timeout: 20000 },
	)
}
async function wait(source) {
	for (let i = 0; i < 100; i++) {
		if (evaluate(`Boolean(${source})`)) return
		await sleep(50)
	}
	throw Error(
		JSON.stringify(
			evaluate(
				'({sample:window.__sidebarSample,text:document.querySelector(".cm-content")?.textContent.slice(0,150)})',
			),
		),
	)
}
function evaluate(source) {
	return JSON.parse(
		browser("eval", "-b", Buffer.from(source).toString("base64")),
	).data.result
}
let cdpUrl = JSON.parse(browser("get", "cdp-url")).data.value
if (!cdpUrl)
	cdpUrl = execFileSync(
		"agent-browser",
		["--session", "sidebar2", "get", "cdp-url"],
		{ encoding: "utf8", timeout: 20000 },
	).trim()
let socket = new globalThis.WebSocket(cdpUrl)
await new Promise(resolve =>
	socket.addEventListener("open", resolve, { once: true }),
)
let serial = 0,
	pending = new Map()
socket.addEventListener("message", event => {
	let value = JSON.parse(String(event.data))
	if (value.id) {
		let p = pending.get(value.id)
		pending.delete(value.id)
		if (value.error) p?.reject(value.error)
		else p?.resolve(value.result)
	}
})
function send(method, params = {}, sessionId) {
	let id = ++serial
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject })
		socket.send(JSON.stringify({ id, method, params, sessionId }))
	})
}
let targets = await send("Target.getTargets"),
	target = targets.targetInfos.find(
		t => t.type === "page" && t.url.includes("4391"),
	),
	{ sessionId } = await send("Target.attachToTarget", {
		targetId: target.targetId,
		flatten: true,
	})
await send("Emulation.setCPUThrottlingRate", { rate: cpu }, sessionId)
await wait(
	`document.querySelector('[data-doc-title="Sidebar 1"] a') && document.querySelector(".cm-content")`,
)
evaluate(
	`navigator.serviceWorker.getRegistrations().then(async registrations=>{for(let registration of registrations)await registration.unregister();return true})`,
)
let servedHtml = execFileSync("curl", ["-s", "http://localhost:4391/app"], {
	encoding: "utf8",
})
let expectedAsset = servedHtml.match(/component-url="([^"]+)"/)?.[1]
let targetDocument = evaluate(
	`(()=>{let item=document.querySelector('[data-doc-title="Sidebar 1"] a');return {path:new URL(item.href).pathname,title:'Sidebar 1'}})()`,
)
let source = `(()=>{window.__sidebarSample={start:0,ready:null,paint:null,interactive:null};let sample=window.__sidebarSample;function poll(){let editor=document.querySelector('.cm-content');if(location.pathname===${JSON.stringify(targetDocument.path)} && (sample.paint!==null || editor?.textContent.includes('# Sidebar 1'))){sample.ready??=performance.now(); if(sample.paint!==null && document.activeElement===editor && editor.textContent.includes(new URLSearchParams(location.search).get('marker'))){sample.interactive=performance.now();return}let r=editor.getBoundingClientRect();let hit=document.elementFromPoint(r.left+25,Math.max(1,r.top+12));if(r.width&&r.height&&editor.contains(hit))sample.paint??=performance.now()}requestAnimationFrame(poll)}requestAnimationFrame(poll)})()`
await send("Page.enable", {}, sessionId)
let { identifier } = await send(
	"Page.addScriptToEvaluateOnNewDocument",
	{ source },
	sessionId,
)
let results = []
for (let mode of ["cold-http", "cached-http", "service-worker"]) {
	await send("Network.enable", {}, sessionId)
	await send(
		"Network.setBypassServiceWorker",
		{ bypass: mode !== "service-worker" },
		sessionId,
	)
	if (mode === "service-worker") {
		evaluate(
			`navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>true)`,
		)
		browser("reload")
		await wait(`Boolean(navigator.serviceWorker.controller)`)
	}
	for (let run = 0; run < runs; run++) {
		let marker = `STARTUPMARKER_${label}_${cpu}_${mode}_${run}`
		if (mode === "cold-http")
			await send("Network.clearBrowserCache", {}, sessionId)
		browser(
			"open",
			"http://localhost:4391" + targetDocument.path + "?marker=" + marker,
		)
		await wait(
			"window.__sidebarSample?.paint !== null && window.__sidebarSample?.paint !== undefined",
		)
		browser("focus", ".cm-content")
		browser("press", "Home")
		browser("keyboard", "inserttext", marker)
		await wait("window.__sidebarSample.interactive !== null")
		let sample = evaluate(
			`({...window.__sidebarSample,controlled:!!navigator.serviceWorker.controller})`,
		)
		let loadedAsset = evaluate(
			`document.querySelector("astro-island")?.getAttribute("component-url")`,
		)
		if (loadedAsset !== expectedAsset)
			throw Error(`Wrong build: ${loadedAsset}; expected ${expectedAsset}`)
		results.push({ mode, cpu, run, loadedAsset, ...sample })
		writeFileSync(
			`test-results/sidebar/${label}-startup-${cpu}.json`,
			JSON.stringify(results, null, 2),
		)
		browser("press", "Meta+z")
		await wait(
			`!document.querySelector('.cm-content').textContent.includes(${JSON.stringify(marker)})`,
		)
		await sleep(500)
		console.log(mode, run, sample.ready, sample.paint, sample.interactive)
	}
}
await send(
	"Page.removeScriptToEvaluateOnNewDocument",
	{ identifier },
	sessionId,
)
socket.close()
writeFileSync(
	`test-results/sidebar/${label}-startup-${cpu}.json`,
	JSON.stringify(results, null, 2),
)
