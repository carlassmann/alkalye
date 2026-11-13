import { type BrowserContext, type Page } from "@playwright/test"
import { installBenchmarkCompatibility } from "./browser"

export { instrument, installObservers, summary }

declare global {
	interface Window {
		__bench: { paint: number[]; longTasks: number[]; inputAt: number | null }
	}
}

async function installObservers(context: BrowserContext) {
	await installBenchmarkCompatibility(context)
	await context.addInitScript(() => {
		window.__bench = { paint: [], longTasks: [], inputAt: null }
		new PerformanceObserver(list => {
			window.__bench.longTasks.push(
				...list.getEntries().map(entry => entry.duration),
			)
		}).observe({ type: "longtask", buffered: true })
		document.addEventListener(
			"beforeinput",
			() => {
				let start = performance.now()
				window.__bench.inputAt = start
				requestAnimationFrame(() =>
					requestAnimationFrame(() =>
						window.__bench.paint.push(performance.now() - start),
					),
				)
			},
			true,
		)
	})
}

async function instrument(page: Page, cpu: number) {
	await page.bringToFront()
	let cdp = await page.context().newCDPSession(page)
	await cdp.send("Network.enable")
	await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
	await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu })
	let wire = { sent: 0, received: 0, http: 0, httpSent: 0, bundle: 0 }
	let bundleIds = new Set<string>()
	cdp.on("Network.requestWillBeSent", event => {
		wire.httpSent += Buffer.byteLength(event.request.postData ?? "")
	})
	cdp.on("Network.responseReceived", event => {
		if (/javascript|wasm/.test(event.response.mimeType))
			bundleIds.add(event.requestId)
	})
	cdp.on("Network.loadingFinished", event => {
		wire.http += event.encodedDataLength
		if (bundleIds.has(event.requestId)) wire.bundle += event.encodedDataLength
	})
	cdp.on("Network.webSocketFrameSent", event => {
		wire.sent += Buffer.byteLength(
			event.response.payloadData,
			event.response.opcode === 2 ? "base64" : "utf8",
		)
	})
	cdp.on("Network.webSocketFrameReceived", event => {
		wire.received += Buffer.byteLength(
			event.response.payloadData,
			event.response.opcode === 2 ? "base64" : "utf8",
		)
	})
	return { cdp, wire }
}

function summary(values: number[]) {
	let sorted = [...values].sort((a, b) => a - b)
	function percentile(p: number) {
		return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
	}
	return { samples: values, median: percentile(0.5), p95: percentile(0.95) }
}
