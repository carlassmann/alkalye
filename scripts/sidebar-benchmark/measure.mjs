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
await send("Network.enable", {}, sessionId)
await send("Network.setBypassServiceWorker", { bypass: true }, sessionId)
evaluate(
	`navigator.serviceWorker.getRegistrations().then(async registrations=>{for(let registration of registrations)await registration.unregister();return true})`,
)
browser("open", "http://localhost:4391/app?measurement=" + label)
let servedHtml = execFileSync("curl", ["-s", "http://localhost:4391/app"], {
	encoding: "utf8",
})
let expectedAsset = servedHtml.match(/component-url="([^"]+)"/)?.[1]
let loadedAsset = evaluate(
	`document.querySelector("astro-island")?.getAttribute("component-url")`,
)
if (!expectedAsset || loadedAsset !== expectedAsset)
	throw Error(`Wrong build: ${loadedAsset}, expected ${expectedAsset}`)
await wait(
	`document.querySelector('[data-doc-title="Sidebar 1"] a') && document.querySelector(".cm-content")`,
)
let results = []
for (let size of ["small", "large"]) {
	let titles =
		size === "small" ? ["Sidebar 1", "Sidebar 2"] : ["Sidebar 3", "Sidebar 4"]
	for (let run = 0; run < runs; run++) {
		console.log(size, run)
		let title = titles[run % 2],
			selector = `[data-doc-title="${title}"] a`
		evaluate(
			`(()=>{let link=document.querySelector(${JSON.stringify(selector)}); if(!link)throw Error('missing target'); let sidebar=document.querySelector('[data-testid="sidebar-left"]')??document.querySelector('[data-side="left"]'); let list=document.querySelector('[data-testid="sidebar-document-list"]'); window.__sidebarSample={start:performance.now(),title:${JSON.stringify(title)},path:new URL(link.href).pathname,ready:null,paint:null,interactive:null,sameList:null}; let sample=window.__sidebarSample; function poll(){let editor=document.querySelector('.cm-content'); if(location.pathname===sample.path && (sample.paint!==null || editor?.textContent.includes('# '+sample.title))){sample.ready??=performance.now()-sample.start;if(sample.paint!==null && document.activeElement===editor && editor.textContent.includes('MARKER'+${run})){sample.interactive=performance.now()-sample.start;return}let r=editor.getBoundingClientRect();let x=Math.max(1,r.left+25),y=Math.max(1,r.top+12);let hit=document.elementFromPoint(x,y);if(r.width&&r.height&&editor.contains(hit)){if(sample.paint===null){sample.paint=performance.now()-sample.start;sample.sameList=list.isConnected;}if(editor.textContent.includes('MARKER'+${run})){sample.interactive=performance.now()-sample.start;return}}}if(performance.now()-sample.start>15000){sample.error='timeout';return}requestAnimationFrame(poll)}requestAnimationFrame(poll);link.click();})()`,
		)
		await wait("window.__sidebarSample.paint !== null")
		browser("focus", ".cm-content")
		browser("press", "Home")
		browser("keyboard", "inserttext", `MARKER${run}`)
		await wait("window.__sidebarSample.interactive !== null")
		results.push({ size, cpu, run, ...evaluate("window.__sidebarSample") })
		browser("press", "Meta+z")
		await wait(
			`!document.querySelector('.cm-content').textContent.includes('MARKER${run}')`,
		)
		await sleep(500)
	}
}
socket.close()
writeFileSync(
	`test-results/sidebar/${label}-${cpu}.json`,
	JSON.stringify(results, null, 2),
)
for (let size of ["small", "large"])
	for (let metric of ["ready", "paint", "interactive"]) {
		let values = results
			.filter(r => r.size === size)
			.map(r => r[metric])
			.sort((a, b) => a - b)
		console.log(
			label,
			cpu,
			size,
			metric,
			values[Math.floor(values.length / 2)],
			values[Math.ceil(values.length * 0.95) - 1],
		)
	}
