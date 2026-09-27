import { z } from "zod"
import { execFileSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"

let label = process.argv[2] ?? "baseline"
let session = process.env.SPLASH_SESSION ?? "splash-bench"
let targetPath =
	process.env.SPLASH_DOCUMENT ??
	new URL((await cli("get", "url")).trim()).pathname.replace(/\/$/, "")
let origin =
	process.env.SPLASH_ORIGIN ?? "https://web-splash-splashbench.localhost"
let runs = Number(process.env.SPLASH_RUNS ?? 7)
let cdpUrl = (await cli("get", "cdp-url")).trim()
let targets = z
	.array(
		z.object({ type: z.string(), webSocketDebuggerUrl: z.string().optional() }),
	)
	.parse(
		await (
			await fetch(new URL("/json/list", cdpUrl.replace("ws:", "http:")))
		).json(),
	)
let pageUrl = targets.find(
	target => target.type === "page",
)?.webSocketDebuggerUrl
if (!pageUrl) throw new Error("No agent-browser page")
let socket = new WebSocket(pageUrl)
await new Promise<void>(resolve =>
	socket.addEventListener("open", () => resolve(), { once: true }),
)
let sequence = 0
let pending = new Map<
	number,
	{ resolve: (value: unknown) => void; reject: (error: Error) => void }
>()
socket.addEventListener("message", event => {
	let packet = z
		.object({
			id: z.number().optional(),
			result: z.unknown().optional(),
			error: z.unknown().optional(),
		})
		.parse(JSON.parse(String(event.data)))
	if (!packet.id) return
	let request = pending.get(packet.id)
	pending.delete(packet.id)
	if (packet.error) request?.reject(new Error(JSON.stringify(packet.error)))
	else request?.resolve(packet.result)
})

let probe = `
window.__splashProbe = { editorReadyMs: null, uncoveredMs: null };
function inspectSplashEditor() {
 let probe = window.__splashProbe;
 if (!probe) return;
 let editor = document.querySelector('.cm-content[contenteditable="true"]');
 if (location.pathname.replace(/\\/$/, '') === ${JSON.stringify(targetPath)} && document.title === 'Splash fixture 100' && editor?.textContent.includes('Splash fixture 100')) {
  let bounds = editor.getBoundingClientRect();
  let x = Math.max(1, bounds.left + 80), y = Math.max(1, bounds.top + 60);
  let visible = bounds.width > 0 && bounds.height > 0 && y < innerHeight && x < innerWidth && getComputedStyle(editor).visibility === 'visible';
  if (visible && probe.editorReadyMs === null) probe.editorReadyMs = performance.now() - (probe.startedAt ?? 0);
  if (visible && editor.contains(document.elementFromPoint(x,y))) {
   probe.uncoveredMs ??= performance.now() - (probe.startedAt ?? 0);
   probe.x = x; probe.y = y;
  }
 }
 requestAnimationFrame(inspectSplashEditor);
}
requestAnimationFrame(inspectSplashEditor);
`
let measurement = z.object({
	editorReadyMs: z.number(),
	uncoveredMs: z.number(),
	x: z.number(),
	y: z.number(),
})
let results = []
try {
	await command("Page.enable")
	await command("Network.enable")
	await command("Page.addScriptToEvaluateOnNewDocument", { source: probe })
	await command("Emulation.setDeviceMetricsOverride", {
		width: 1280,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	})
	for (let cpu of [1, 4]) {
		await command("Emulation.setCPUThrottlingRate", { rate: cpu })
		for (let mode of [
			"cold-http",
			"cached-http",
			"service-worker",
			"offline",
			"switch",
		]) {
			await command("Network.setBypassServiceWorker", {
				bypass: mode === "cold-http" || mode === "cached-http",
			})
			if (mode === "service-worker") {
				await evaluate(
					`(async () => { let r = await navigator.serviceWorker.ready; return r.active?.state; })()`,
				)
			}
			await command("Network.emulateNetworkConditions", {
				offline: mode === "offline",
				latency: 0,
				downloadThroughput: -1,
				uploadThroughput: -1,
			})
			for (let run = 1; run <= runs; run++) {
				if (mode === "cold-http") await command("Network.clearBrowserCache")
				if (mode === "switch") {
					await showDocuments()
					await cli(
						"fill",
						'[data-testid="doc-search-input"]',
						"Splash fixture 099",
					)
					await cli("click", '[data-doc-title="Splash fixture 099"] a')
					await poll(async () =>
						(await evaluate(
							"document.title === 'Splash fixture 099' && document.querySelector('.cm-content')?.textContent.includes('Splash fixture 099')",
						)) === true
							? true
							: null,
					)
					await showDocuments()
					await cli(
						"fill",
						'[data-testid="doc-search-input"]',
						"Splash fixture 100",
					)
					await cli("wait", '[data-doc-title="Splash fixture 100"]')
					let point = z
						.object({ x: z.number(), y: z.number() })
						.parse(
							await evaluate(
								`(() => { let b = document.querySelector('[data-doc-title="Splash fixture 100"] a').getBoundingClientRect(); return { x: b.left + b.width/2, y: b.top + b.height/2 }; })()`,
							),
						)
					await evaluate(
						"window.__splashProbe = {editorReadyMs:null,uncoveredMs:null,startedAt:performance.now()}",
					)
					await command("Input.dispatchMouseEvent", {
						type: "mousePressed",
						...point,
						button: "left",
						clickCount: 1,
					})
					await command("Input.dispatchMouseEvent", {
						type: "mouseReleased",
						...point,
						button: "left",
						clickCount: 1,
					})
				} else {
					await evaluate("window.__splashProbe = null")
					await command("Page.navigate", { url: origin + targetPath })
				}
				let ready = await poll(async () => {
					let value = await evaluate("window.__splashProbe")
					let parsed = measurement.safeParse(value)
					return parsed.success ? parsed.data : null
				})
				let originalContent = await evaluate(
					"document.querySelector('.cm-content')?.textContent",
				)
				let marker = `splash-${label}-${cpu}-${mode}-${run}`
				await command("Input.dispatchMouseEvent", {
					type: "mousePressed",
					x: ready.x,
					y: ready.y,
					button: "left",
					clickCount: 1,
				})
				await command("Input.dispatchMouseEvent", {
					type: "mouseReleased",
					x: ready.x,
					y: ready.y,
					button: "left",
					clickCount: 1,
				})
				await command("Input.insertText", { text: marker })
				let interactiveMs = await poll(async () => {
					let value = await evaluate(
						`document.querySelector('.cm-content')?.textContent.includes(${JSON.stringify(marker)}) && document.querySelector('.cm-content')?.contains(document.activeElement) ? performance.now() - (window.__splashProbe.startedAt ?? 0) : null`,
					)
					return typeof value === "number" ? value : null
				})
				let controlled = await evaluate("!!navigator.serviceWorker.controller")
				if ((mode === "service-worker" || mode === "offline") && !controlled)
					throw new Error("Service worker not controlling page")
				await command("Input.dispatchKeyEvent", {
					type: "keyDown",
					key: "z",
					code: "KeyZ",
					modifiers: 4,
				})
				await command("Input.dispatchKeyEvent", {
					type: "keyUp",
					key: "z",
					code: "KeyZ",
					modifiers: 4,
				})
				await poll(async () =>
					(await evaluate(
						`!document.querySelector('.cm-content')?.textContent.includes(${JSON.stringify(marker)})`,
					)) === true
						? true
						: null,
				)
				if (
					(await evaluate(
						"document.querySelector('.cm-content')?.textContent",
					)) !== originalContent
				)
					throw new Error("Fixture was not restored")
				await sleep(1100)
				let row = { label, cpu, mode, run, ...ready, interactiveMs, controlled }
				results.push(row)
				console.error(JSON.stringify(row))
			}
		}
		await command("Network.emulateNetworkConditions", {
			offline: false,
			latency: 0,
			downloadThroughput: -1,
			uploadThroughput: -1,
		})
	}
	await writeFile(
		`scripts/splash-benchmark/${label}.json`,
		JSON.stringify(
			{
				label,
				runs,
				targetPath,
				conditions: {
					browser: await evaluate("navigator.userAgent"),
					viewport: "1280x900",
					network: "loopback HTTPS, no network throttling",
					library: "100 disposable 8 KiB Markdown documents plus welcome",
					endpoint:
						"requested document and content visible; hit-test editor; mouse click, insert unique text, confirm focused editor contains it; undo and wait 1100ms before next run",
				},
				results,
			},
			null,
			2,
		) + "\n",
	)
} finally {
	await command("Emulation.setCPUThrottlingRate", { rate: 1 })
	await command("Network.emulateNetworkConditions", {
		offline: false,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	})
	socket.close()
}

function command(
	method: string,
	params: Record<string, unknown> = {},
): Promise<unknown> {
	let id = ++sequence
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject })
		socket.send(JSON.stringify({ id, method, params }))
	})
}

async function evaluate(expression: string) {
	let response = await command("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true,
	})
	let parsed = z
		.object({
			result: z.object({ value: z.unknown().optional() }),
			exceptionDetails: z.unknown().optional(),
		})
		.parse(response)
	if (parsed.exceptionDetails)
		throw new Error(JSON.stringify(parsed.exceptionDetails))
	return parsed.result.value
}

async function poll<T>(read: () => Promise<T | null>): Promise<T> {
	let deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		try {
			let value = await read()
			if (value !== null) return value
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("context"))
				throw error
		}
		await sleep(5)
	}
	throw new Error("Timed out waiting for correct, usable editor")
}

async function cli(...args: string[]) {
	return execFileSync("agent-browser", ["--session", session, ...args], {
		encoding: "utf8",
	})
}

async function showDocuments() {
	let visible =
		"document.querySelector('[data-testid=doc-search-input]')?.getBoundingClientRect().left >= 0"
	if ((await evaluate(visible)) !== true)
		await cli("find", "role", "button", "click", "--name", "Documents")
	await poll(async () => ((await evaluate(visible)) === true ? true : null))
}
