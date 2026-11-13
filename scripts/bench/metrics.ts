import { captureNetwork } from "./network"
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
	await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu })
	let network = await captureNetwork(page, cdp)
	return { cdp, ...network }
}

function summary(values: number[]) {
	let sorted = [...values].sort((a, b) => a - b)
	function percentile(p: number) {
		return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
	}
	return { samples: values, median: percentile(0.5), p95: percentile(0.95) }
}
