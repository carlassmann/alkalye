import { captureNetwork } from "./network"
import { type BrowserContext, type Page } from "@playwright/test"
import { installBenchmarkCompatibility } from "./browser"

export { instrument, installObservers, summary }

declare global {
	interface Window {
		__bench: {
			paint: number[]
			longTasks: number[]
			inputAt: number | null
			events: {
				name: string
				duration: number
				inputDelay: number
				processing: number
				presentation: number
			}[]
		}
	}
}

async function installObservers(context: BrowserContext) {
	await installBenchmarkCompatibility(context)
	await context.addInitScript(() => {
		window.__bench = {
			paint: [],
			longTasks: [],
			inputAt: null,
			events: [],
		}
		new PerformanceObserver(list => {
			window.__bench.longTasks.push(
				...list.getEntries().map(entry => entry.duration),
			)
		}).observe({ type: "longtask", buffered: true })
		new PerformanceObserver(list => {
			for (let entry of list.getEntries()) {
				if (entry instanceof PerformanceEventTiming)
					window.__bench.events.push({
						name: entry.name,
						duration: entry.duration,
						inputDelay: entry.processingStart - entry.startTime,
						processing: entry.processingEnd - entry.processingStart,
						presentation: Math.max(
							0,
							entry.startTime + entry.duration - entry.processingEnd,
						),
					})
			}
		}).observe({ type: "event", durationThreshold: 16, buffered: true })
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
