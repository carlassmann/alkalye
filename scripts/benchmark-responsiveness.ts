import { chromium, type Page } from "@playwright/test"
import { create } from "../e2e/doc-helpers"
import { testIds } from "../src/app/lib/test-ids"

type InteractionMetric = {
	name: string
	interactionId: number
	durationMs: number
	inputDelayMs: number
	processingMs: number
	presentationDelayMs: number
}

type LongFrameMetric = {
	durationMs: number
	scripts: {
		sourceURL: string
		functionName: string
		durationMs: number
	}[]
}

declare global {
	interface Window {
		__alkalyeInteractionMetrics: InteractionMetric[]
		__alkalyeLongFrames: LongFrameMetric[]
		__alkalyeMeasurementStartedAt: number
	}

	interface PerformanceEventTiming {
		readonly interactionId: number
	}

	interface PerformanceEntry {
		readonly scripts?: PerformanceScriptTiming[]
	}

	interface PerformanceScriptTiming {
		readonly sourceURL: string
		readonly functionName: string
		readonly duration: number
	}

	interface PerformanceObserverInit {
		durationThreshold?: number
	}
}

type Measurement = {
	name: string
	interactionCount: number
	medianMs: number
	p95Ms: number
	maximumMs: number
	maximumInputDelayMs: number
	maximumProcessingMs: number
	maximumPresentationDelayMs: number
	longFrameCount: number
	maximumLongFrameMs: number
	slowestFrameScripts: LongFrameMetric["scripts"]
}

let args = parseArgs(process.argv.slice(2))
let browser = await chromium.launch({ headless: !args.headed })
let context = await browser.newContext({
	baseURL: args.url,
	ignoreHTTPSErrors: true,
	serviceWorkers: "block",
	viewport: { width: 1280, height: 900 },
})

try {
	let page = await context.newPage()
	page.setDefaultNavigationTimeout(120_000)
	await installObservers(page)

	console.error(`Seeding two ${args.kb} KB documents...`)
	let seedStartedAt = performance.now()
	let first = await create(page, {
		title: "Responsiveness A",
	})
	console.error("Created first document")
	await replaceEditorContent(page, buildContent("Responsiveness A", args.kb))
	console.error("Filled first document")
	await create(page, {
		title: "Responsiveness B",
	})
	console.error("Created second document")
	await replaceEditorContent(page, buildContent("Responsiveness B", args.kb))
	console.error(
		`Seeded documents in ${Math.round(performance.now() - seedStartedAt)} ms`,
	)
	await page.waitForTimeout(2_000)
	await page.setViewportSize({ width: 390, height: 844 })

	let session = await context.newCDPSession(page)
	await session.send("Emulation.setCPUThrottlingRate", { rate: args.cpu })

	let measurements: Measurement[] = []
	let editor = page.getByTestId(testIds.doc.editor).locator(".cm-content")
	await editor.press("Control+End")
	measurements.push(
		await measure(page, "typing", async () => {
			await page.keyboard.type(" instant response", { delay: 30 })
		}),
	)

	let leftSidebarTrigger = page.getByRole("button", { name: "Documents" })
	measurements.push(
		await measure(page, "open sidebar", () => leftSidebarTrigger.click()),
	)

	let search = page.getByTestId(testIds.doc.searchInput)
	await search.click()
	measurements.push(
		await measure(page, "filter documents", async () => {
			await page.keyboard.type("Responsiveness A", { delay: 30 })
			await page
				.locator(`[data-doc-id="${first.id}"]`)
				.waitFor({ state: "visible" })
		}),
	)

	measurements.push(
		await measure(page, "open document", async () => {
			await page.locator(`[data-doc-id="${first.id}"] a`).click()
			await page.waitForFunction(
				docId => window.location.pathname.endsWith(`/doc/${docId}`),
				first.id,
			)
			await page
				.getByTestId(testIds.doc.editor)
				.locator(".cm-content")
				.waitFor({
					state: "visible",
				})
		}),
	)

	let result = {
		profile: {
			cpuThrottle: args.cpu,
			viewport: "390x844",
			documentKilobytes: args.kb,
			frameBudgetMs: 16.7,
		},
		measurements,
	}

	console.log(JSON.stringify(result, null, 2))
} finally {
	await context.close()
	await browser.close()
}

async function installObservers(page: Page) {
	await page.addInitScript(() => {
		window.__alkalyeInteractionMetrics = []
		window.__alkalyeLongFrames = []
		window.__alkalyeMeasurementStartedAt = 0

		new PerformanceObserver(list => {
			for (let entry of list.getEntries()) {
				let event = entry as PerformanceEventTiming
				if (
					event.interactionId === 0 ||
					event.startTime < window.__alkalyeMeasurementStartedAt
				)
					continue
				window.__alkalyeInteractionMetrics.push({
					name: event.name,
					interactionId: event.interactionId,
					durationMs: event.duration,
					inputDelayMs: event.processingStart - event.startTime,
					processingMs: event.processingEnd - event.processingStart,
					presentationDelayMs: Math.max(
						0,
						event.duration - (event.processingEnd - event.startTime),
					),
				})
			}
		}).observe({ type: "event", buffered: true, durationThreshold: 0 })

		if (
			PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")
		) {
			new PerformanceObserver(list => {
				for (let entry of list.getEntries()) {
					if (entry.startTime < window.__alkalyeMeasurementStartedAt) continue
					window.__alkalyeLongFrames.push({
						durationMs: entry.duration,
						scripts: (entry.scripts ?? []).map(script => ({
							sourceURL: script.sourceURL,
							functionName: script.functionName,
							durationMs: script.duration,
						})),
					})
				}
			}).observe({ type: "long-animation-frame", buffered: true })
		}
	})
}

async function measure(
	page: Page,
	name: string,
	action: () => Promise<unknown>,
): Promise<Measurement> {
	await page.evaluate(() => {
		window.__alkalyeInteractionMetrics = []
		window.__alkalyeLongFrames = []
		window.__alkalyeMeasurementStartedAt = performance.now()
	})

	await action()
	await page.waitForTimeout(500)

	let metrics = await page.evaluate(() => {
		return {
			interactions: [...window.__alkalyeInteractionMetrics],
			longFrames: [...window.__alkalyeLongFrames],
		}
	})
	let interactions = groupInteractions(metrics.interactions)
	let interactionDurations = interactions.map(
		interaction => interaction.durationMs,
	)
	let slowestFrame = [...metrics.longFrames].sort(
		(left, right) => right.durationMs - left.durationMs,
	)[0]

	return {
		name,
		interactionCount: interactionDurations.length,
		medianMs: percentile(interactionDurations, 0.5),
		p95Ms: percentile(interactionDurations, 0.95),
		maximumMs: Math.max(0, ...interactionDurations),
		maximumInputDelayMs: Math.max(
			0,
			...interactions.map(interaction => interaction.inputDelayMs),
		),
		maximumProcessingMs: Math.max(
			0,
			...interactions.map(interaction => interaction.processingMs),
		),
		maximumPresentationDelayMs: Math.max(
			0,
			...interactions.map(interaction => interaction.presentationDelayMs),
		),
		longFrameCount: metrics.longFrames.length,
		maximumLongFrameMs: slowestFrame?.durationMs ?? 0,
		slowestFrameScripts: slowestFrame?.scripts ?? [],
	}
}

function groupInteractions(metrics: InteractionMetric[]) {
	let interactions = new Map<number, InteractionMetric>()
	for (let metric of metrics) {
		let current = interactions.get(metric.interactionId)
		if (!current || metric.durationMs > current.durationMs) {
			interactions.set(metric.interactionId, metric)
		}
	}
	return Array.from(interactions.values())
}

function percentile(values: number[], percentileValue: number) {
	let sorted = [...values].sort((left, right) => left - right)
	let index = Math.ceil(sorted.length * percentileValue) - 1
	return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0
}

function buildBody(kilobytes: number) {
	let line = "Low-end responsiveness fixture with realistic markdown content.\n"
	let targetLength = kilobytes * 1024
	return line
		.repeat(Math.ceil(targetLength / line.length))
		.slice(0, targetLength)
}

function buildContent(title: string, kilobytes: number) {
	return `# ${title}\n\n${buildBody(kilobytes)}`
}

async function replaceEditorContent(page: Page, content: string) {
	let editor = page.getByTestId(testIds.doc.editor).locator(".cm-content")
	await editor.click()
	await editor.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
	let chunkSize = 64 * 1024
	for (let offset = 0; offset < content.length; offset += chunkSize) {
		await page.keyboard.insertText(content.slice(offset, offset + chunkSize))
	}
	await page.waitForTimeout(1_000)
}

function parseArgs(rawArgs: string[]) {
	let parsed = {
		url:
			process.env.PLAYWRIGHT_BASE_URL ?? "https://web-main-alkalye.localhost",
		cpu: 4,
		kb: 128,
		headed: false,
	}

	for (let index = 0; index < rawArgs.length; index++) {
		let arg = rawArgs[index]
		if (arg === "--headed") parsed.headed = true
		else if (arg === "--url") parsed.url = requireValue(rawArgs, ++index, arg)
		else if (arg === "--cpu") {
			parsed.cpu = parsePositiveNumber(rawArgs, ++index, arg)
		} else if (arg === "--kb") {
			parsed.kb = parsePositiveNumber(rawArgs, ++index, arg)
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}

	return parsed
}

function requireValue(rawArgs: string[], index: number, flag: string) {
	let value = rawArgs[index]
	if (!value) throw new Error(`${flag} requires a value`)
	return value
}

function parsePositiveNumber(rawArgs: string[], index: number, flag: string) {
	let value = Number(requireValue(rawArgs, index, flag))
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${flag} requires a positive number`)
	}
	return value
}
