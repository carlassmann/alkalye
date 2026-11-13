import { benchmarkBrowserArgs } from "./network"
import { measureReplay, withDeadline } from "./replay"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import {
	chromium,
	expect,
	type Browser,
	type BrowserContext,
} from "@playwright/test"
import { parseArgs } from "node:util"
import { cpus, platform, release, loadavg } from "node:os"
import { fetchDatasets } from "./fetch"
import { loadDatasets } from "./datasets"
import {
	createAccount,
	waitForEditorBoot,
	seed,
	resolveDocument,
	openDocument,
	configureEditor,
	captureCredentials,
	verifyExport,
	editor,
} from "./adapter"
import { installObservers, instrument, summary } from "./metrics"

let { values } = parseArgs({
	args: process.argv.slice(2).filter(arg => arg !== "--"),
	options: {
		target: { type: "string" },
		label: { type: "string" },
		out: { type: "string" },
		runs: { type: "string", default: "3" },
		cpu: { type: "string", default: "1" },
		notes: { type: "string", default: "50" },
		edits: { type: "string", default: "200" },
		"replay-timeout-ms": { type: "string" },
		"large-only": { type: "boolean", default: false },
	},
})
if (!values.target || !values.label || !values.out)
	throw new Error(
		"Required: --target <url> --label classic|v2 --out <path> [--runs 3 --cpu 1 --notes 50 --edits 200|full]",
	)
let target = values.target
let runs = positive(values.runs)
let cpu = positive(values.cpu)
let notes = positive(values.notes)
let sources = await fetchDatasets()
let { documents, trace } = await loadDatasets(notes)
let editCount =
	values.edits === "full" ? trace.edits.length : positive(values.edits)
let replayTimeoutMs = values["replay-timeout-ms"]
	? positive(values["replay-timeout-ms"])
	: Math.max(120_000, editCount * 500)
if (replayTimeoutMs > 2_147_483_647)
	throw new Error("Replay deadline exceeds timer range")
if (editCount > trace.edits.length)
	throw new Error("Requested more edits than trace contains")
let browser = await chromium.launch({
	headless: true,
	args: benchmarkBrowserArgs,
})
let samples: Record<string, number[]> = {}
let scenarioFailures: {
	run: number
	scenario: string
	elapsedMs: number
	message: string
}[] = []
let runLoads: { run: number; start: number[]; end?: number[] }[] = []
let syncDiagnostics: unknown[] = []
let result = {
	runLoads,
	syncDiagnostics,
	label: values.label,
	target,
	createdAt: new Date().toISOString(),
	environment: {
		platform: platform(),
		release: release(),
		cpu: cpus()[0]?.model,
		cores: cpus().length,
		browser: browser.version(),
		cpuThrottle: cpu,
		networkCapture: "CDP pages, iframes, dedicated workers and SharedWorkers",
		serverRuntime: process.env.BENCH_SERVER_NOTE ?? "unspecified",
		jazz:
			process.env.BENCH_JAZZ ??
			JSON.parse(await readFile("package.json", "utf8")).dependencies[
				"jazz-tools"
			],
		gitHead:
			process.env.BENCH_GIT_HEAD ??
			execFileSync("git", ["rev-parse", "HEAD"], {
				encoding: "utf8",
			}).trim(),
		server:
			"production Node adapter; local store; first visit SW blocked, returning SW installed",
	},
	config: {
		runs,
		notes,
		edits: editCount,
		totalTraceEdits: trace.edits.length,
		automaticPairsAndCompletion: false,
		replayTimeoutMs,
	},
	sources,
	datasets: documents.map(doc => ({
		title: doc.title,
		source: doc.source,
		bytes: Buffer.byteLength(doc.content),
	})),
	completedRuns: 0,
	scenarioFailures,
	metrics: {},
}

try {
	for (let run = 0; run < runs; run++) {
		console.error(
			`Run ${run + 1}/${runs}: import ${documents.length} documents`,
		)
		runLoads.push({ run: run + 1, start: loadavg() })
		let context = await newContext(browser)
		try {
			let page = await context.newPage()
			let sourceNetwork = await instrument(page, cpu)
			page.on("pageerror", error => console.error(error.message))
			page.on("console", message => {
				if (message.type() === "error") console.error(message.text())
			})
			await createAccount(page)
			await configureEditor(page)
			console.error("Account ready; importing ZIP")
			let start = performance.now()
			let seeded = await seed(page, documents)
			add("importMs", performance.now() - start)
			await page.waitForTimeout(5000)
			let storage = await page.evaluate(() => navigator.storage.estimate())
			add(
				"indexedDBBytes",
				z
					.object({ usageDetails: z.object({ indexedDB: z.number() }) })
					.parse(storage).usageDetails.indexedDB,
			)
			let credentials = await captureCredentials(context)
			let large = seeded.find(doc => doc.title === "Book dracula")
			let medium = seeded.find(doc => doc.title === "Book alice")
			if (!large || !medium) throw new Error("Books missing")

			console.error("Cold list and large-document open")
			for (let scenario of ["coldListMs", "coldLargeOpenMs"]) {
				let fresh = await newContext(browser, credentials)
				try {
					let cold = await fresh.newPage()
					let network = await instrument(cold, cpu)
					start = performance.now()
					if (scenario === "coldListMs") {
						await cold.goto("/app", { waitUntil: "domcontentloaded" })
						await resolveDocument(cold, large.title)
					} else {
						await waitForEditorBoot(cold, { path: `/app/doc/${large.id}` })
						await expect(editor(cold)).toContainText("Book dracula", {
							timeout: 120_000,
						})
					}
					add(scenario, performance.now() - start)
					await cold.waitForTimeout(1000)
					network.ensureHealthy()
					if (scenario === "coldListMs")
						add("firstLoadJsWasmBytes", network.wire.bundle)
				} finally {
					await fresh.close()
				}
			}
			await page.bringToFront()
			await sourceNetwork.setCacheDisabled(false)
			await waitForEditorBoot(page)
			start = performance.now()
			await page.reload({ waitUntil: "domcontentloaded" })
			await resolveDocument(page, large.title)
			add("warmListMs", performance.now() - start)

			console.error(
				"Fresh device: credentials-only restore and verified bulk export",
			)
			let receiver = await newContext(browser, credentials)
			start = performance.now()
			try {
				let other = await receiver.newPage()
				await instrument(other, cpu)
				await waitForEditorBoot(other)
				console.error("Fresh device ready; exporting all bodies")
				await verifyExport(other, seeded)
				add("freshDeviceWholeDatasetMs", performance.now() - start)
			} catch (error) {
				let message = error instanceof Error ? error.message : String(error)
				scenarioFailures.push({
					run: run + 1,
					scenario: "freshDeviceWholeDatasetMs",
					elapsedMs: performance.now() - start,
					message: message.slice(0, 1000),
				})
				console.error(`Fresh-device failure: ${message.slice(0, 200)}`)
			} finally {
				await receiver.close()
			}
			console.error("Sync: independent second client on the small note")
			let syncReceiver = await newContext(browser, credentials)
			try {
				let other = await syncReceiver.newPage()
				let syncNetwork = await instrument(other, cpu)
				let syncDoc = seeded[0]
				if (!syncDoc) throw new Error("Small sync note missing")
				await openDocument(other, syncDoc)
				await editor(other).focus()
				await other.keyboard.press("ControlOrMeta+End")
				await openDocument(page, syncDoc)
				for (let n = 0; n < 5; n++) {
					console.error(`Sync marker ${n + 1}/5`)
					let marker = ` sync-${run}-${n}`
					await editor(page).focus()
					await page.keyboard.press("ControlOrMeta+End")
					start = performance.now()
					await page.keyboard.insertText(marker)
					await expect
						.poll(() => editor(other).innerText(), {
							timeout: 120_000,
							intervals: [20],
						})
						.toContain(marker)
					let elapsedMs = performance.now() - start
					add("syncEditMs", elapsedMs)
					syncDiagnostics.push({
						marker,
						elapsedMs,
						load: loadavg(),
						sender: { ...sourceNetwork.wire },
						senderTimeline: sourceNetwork.timeline.slice(-200),
						receiverTimeline: syncNetwork.timeline.slice(-200),
						receiver: { ...syncNetwork.wire },
					})
				}
			} finally {
				await syncReceiver.close()
			}

			for (let doc of values["large-only"]
				? [large]
				: [seeded[0], medium, large]) {
				if (!doc) throw new Error("Small note missing")
				let name = doc === large ? "large" : doc === medium ? "medium" : "small"
				console.error(`Replay ${editCount} edits in isolated ${name} context`)
				let typingContext = await newContext(browser, credentials)
				let replayStarted = performance.now()
				try {
					let typingPage = await typingContext.newPage()
					let metrics = await withDeadline(
						measureReplay(typingPage, {
							document: doc,
							edits: trace.edits.slice(0, editCount),
							cpu,
							reset: name === "small",
							finalText:
								editCount === trace.edits.length ? trace.finalText : undefined,
						}),
						replayTimeoutMs,
						`${name} replay`,
					)
					for (let value of metrics.handler) add(`${name}InputHandlerMs`, value)
					for (let event of metrics.events) {
						add(`${name}EventDurationMs`, event.duration)
						add(`${name}EventInputDelayMs`, event.inputDelay)
						add(`${name}EventProcessingMs`, event.processing)
						add(`${name}EventPresentationMs`, event.presentation)
					}
					for (let value of metrics.paint) add(`${name}InputToPaintMs`, value)
					for (let value of metrics.dispatchToPaint)
						add(`${name}DispatchToPaintMs`, value)
					add(`${name}LongTaskCount`, metrics.longTaskCount)
					add(`${name}LongTaskTotalMs`, metrics.longTaskTotalMs)
					add(`${name}SentBytesPerEdit`, metrics.sentBytesPerEdit)
					add(`${name}ReceivedWsBytesPerEdit`, metrics.receivedWsBytesPerEdit)
					add(`${name}JsHeapBytes`, metrics.jsHeapBytes)
				} catch (error) {
					let message = error instanceof Error ? error.message : String(error)
					scenarioFailures.push({
						run: run + 1,
						scenario: `${name}Replay`,
						elapsedMs: performance.now() - replayStarted,
						message: message.slice(0, 1000),
					})
					console.error(`${name} replay failure: ${message.slice(0, 200)}`)
				} finally {
					await typingContext.close()
				}
			}

			console.error("Returning user: service worker and offline reload")
			let returning = await newContext(browser, credentials, true)
			try {
				let returningPage = await returning.newPage()
				await waitForEditorBoot(returningPage)
				await openDocument(returningPage, large)
				await returningPage.evaluate(async () => {
					await navigator.serviceWorker.register("/sw.js", { scope: "/app/" })
					await navigator.serviceWorker.ready
				})
				await returningPage.reload()
				await expect
					.poll(() =>
						returningPage.evaluate(() => !!navigator.serviceWorker.controller),
					)
					.toBe(true)
				start = performance.now()
				await returningPage.reload({ waitUntil: "domcontentloaded" })
				await resolveDocument(returningPage, large.title)
				add("returningSwListMs", performance.now() - start)
				await returning.setOffline(true)
				start = performance.now()
				await waitForEditorBoot(returningPage, { path: `/app/doc/${large.id}` })
				await expect(editor(returningPage)).toContainText("Book dracula")
				add("offlineSwLargeOpenMs", performance.now() - start)
			} catch (error) {
				scenarioFailures.push({
					run: run + 1,
					scenario: "returningServiceWorker",
					elapsedMs: performance.now() - start,
					message: String(error).slice(0, 1000),
				})
			} finally {
				await returning.close()
			}
			let load = runLoads.at(-1)
			if (load) load.end = loadavg()
			result.completedRuns++
			await save()
		} finally {
			await context.close()
		}
	}
} catch (error) {
	await save()
	throw error
} finally {
	await browser.close()
}

async function newContext(
	browser: Browser,
	storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>,
	allowServiceWorker = false,
) {
	let context = await browser.newContext({
		baseURL: target,
		ignoreHTTPSErrors: true,
		permissions: ["clipboard-read", "clipboard-write"],
		serviceWorkers: allowServiceWorker ? "allow" : "block",
		viewport: { width: 1280, height: 900 },
		storageState,
	})
	context.setDefaultTimeout(120_000)
	context.setDefaultNavigationTimeout(120_000)
	await installObservers(context)
	return context
}
function positive(value: string) {
	let n = Number(value)
	if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n))
		throw new Error(`Expected positive integer: ${value}`)
	return n
}
function add(name: string, value: number) {
	if (!name.includes("ToPaint")) console.error(`${name}: ${value.toFixed(2)}`)
	;(samples[name] ??= []).push(value)
}
async function save() {
	result.metrics = Object.fromEntries(
		Object.entries(samples).map(([name, values]) => [name, summary(values)]),
	)
	await mkdir(dirname(values.out!), { recursive: true })
	await writeFile(values.out!, JSON.stringify(result, null, "\t") + "\n")
}

if (scenarioFailures.length > 0) process.exitCode = 1
