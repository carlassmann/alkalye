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
import { cpus, platform, release } from "node:os"
import { fetchDatasets } from "./fetch"
import { loadDatasets } from "./datasets"
import {
	createAccount,
	signIn,
	waitForEditorBoot,
	seed,
	resolveDocument,
	readContent,
	openDocument,
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
if (editCount > trace.edits.length)
	throw new Error("Requested more edits than trace contains")
let browser = await chromium.launch({ headless: true })
let samples: Record<string, number[]> = {}
let result = {
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
		serverRuntime: process.env.BENCH_SERVER_NOTE ?? "unspecified",
		jazz: JSON.parse(await readFile("package.json", "utf8")).dependencies[
			"jazz-tools"
		],
		gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		server:
			"work astro dev + local sync; service workers blocked; HTTP cache disabled except warm reload",
	},
	config: {
		runs,
		notes,
		edits: editCount,
		totalTraceEdits: trace.edits.length,
	},
	sources,
	datasets: documents.map(doc => ({
		title: doc.title,
		source: doc.source,
		bytes: Buffer.byteLength(doc.content),
	})),
	completedRuns: 0,
	metrics: {},
}

try {
	for (let run = 0; run < runs; run++) {
		console.error(
			`Run ${run + 1}/${runs}: import ${documents.length} documents`,
		)
		let context = await newContext(browser)
		try {
			let page = await context.newPage()
			let { wire, cdp } = await instrument(page, cpu)
			page.on("pageerror", error => console.error(error.message))
			page.on("console", message => {
				if (message.type() === "error") console.error(message.text())
			})
			let account = await createAccount(page)
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
			let credentials = await context.storageState()
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
					await waitForEditorBoot(cold, {
						path: scenario === "coldListMs" ? "/app" : `/app/doc/${large.id}`,
					})
					if (scenario === "coldListMs")
						await resolveDocument(cold, large.title)
					else
						await expect(editor(cold)).toContainText("Book dracula", {
							timeout: 120_000,
						})
					add(scenario, performance.now() - start)
					await cold.waitForTimeout(1000)
					if (scenario === "coldListMs")
						add("firstLoadJsWasmBytes", network.wire.bundle)
				} finally {
					await fresh.close()
				}
			}
			await cdp.send("Network.setCacheDisabled", { cacheDisabled: false })
			await waitForEditorBoot(page)
			start = performance.now()
			await page.reload({ waitUntil: "domcontentloaded" })
			await page.waitForFunction(
				() => document.body.dataset.alkalyeReady === "true",
			)
			await resolveDocument(page, large.title)
			add("warmListMs", performance.now() - start)

			console.error("Fresh device: sign in and verify every document body")
			let receiver = await newContext(browser)
			try {
				let other = await receiver.newPage()
				await instrument(other, cpu)
				start = performance.now()
				await signIn(other, { passphrase: account.passphrase })
				await waitForEditorBoot(other)
				for (let doc of seeded) {
					console.error(`Verifying ${doc.title}`)
					await openDocument(other, doc)
					await expect
						.poll(() => readContent(other), { timeout: 120_000 })
						.toBe(doc.content)
				}
				add("freshDeviceWholeDatasetMs", performance.now() - start)
				let syncDoc = seeded[0]
				if (!syncDoc) throw new Error("Small sync note missing")
				await openDocument(other, syncDoc)
				await editor(other).click()
				await other.keyboard.press("ControlOrMeta+End")
				await page.bringToFront()
				await openDocument(page, syncDoc)
				for (let n = 0; n < 5; n++) {
					console.error(`Sync marker ${n + 1}/5`)
					let marker = ` sync-${run}-${n}`
					await editor(page).click()
					await page.keyboard.press("ControlOrMeta+End")
					start = performance.now()
					await page.keyboard.insertText(marker)
					await expect
						.poll(() => editor(other).innerText(), {
							timeout: 120_000,
							intervals: [20],
						})
						.toContain(marker)
					add("syncEditMs", performance.now() - start)
				}
			} finally {
				await receiver.close()
			}

			for (let doc of [seeded[0], medium, large]) {
				if (!doc) throw new Error("Small note missing")
				let name = doc === large ? "large" : doc === medium ? "medium" : "small"
				console.error(`Replay ${editCount} trace edits on ${name}`)
				await openDocument(page, doc)
				await editor(page).click()
				await page.keyboard.press("ControlOrMeta+A")
				await page.keyboard.insertText(doc.content)
				await page.keyboard.press("ControlOrMeta+Home")
				await page.waitForTimeout(3000)
				await page.evaluate(() => {
					window.__bench.paint = []
					window.__bench.longTasks = []
				})
				let before = { ...wire }
				let cursor = 0
				let expected: string[] = []
				for (let [position, remove, insert = ""] of trace.edits.slice(
					0,
					editCount,
				)) {
					while (cursor < position) {
						await page.keyboard.press("ArrowRight")
						cursor++
					}
					while (cursor > position) {
						await page.keyboard.press("ArrowLeft")
						cursor--
					}
					for (let i = 0; i < remove; i++) await page.keyboard.press("Delete")
					if (insert) await page.keyboard.insertText(insert)
					cursor += insert.length
					expected.splice(position, remove, ...insert)
					await page.evaluate(
						() =>
							new Promise<void>(resolve =>
								requestAnimationFrame(() =>
									requestAnimationFrame(() => resolve()),
								),
							),
					)
				}
				await page.waitForTimeout(3000)
				let metrics = await page.evaluate(() => window.__bench)
				let actual = await readContent(page)
				if (actual !== expected.join("") + doc.content)
					throw new Error(`Trace replay diverged on ${name}`)
				if (
					editCount === trace.edits.length &&
					expected.join("") !== trace.finalText
				)
					throw new Error("Full trace final text mismatch")
				for (let value of metrics.paint) add(`${name}InputToPaintMs`, value)
				add(`${name}LongTaskCount`, metrics.longTasks.length)
				add(
					`${name}LongTaskTotalMs`,
					metrics.longTasks.reduce((a, b) => a + b, 0),
				)
				add(
					`${name}SentBytesPerEdit`,
					(wire.sent - before.sent + wire.httpSent - before.httpSent) /
						editCount,
				)
				add(
					`${name}ReceivedWsBytesPerEdit`,
					(wire.received - before.received) / editCount,
				)
				let heap = await cdp.send("Runtime.getHeapUsage")
				add(`${name}JsHeapBytes`, heap.usedSize)
			}
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
) {
	let context = await browser.newContext({
		baseURL: target,
		ignoreHTTPSErrors: true,
		permissions: ["clipboard-read", "clipboard-write"],
		serviceWorkers: "block",
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
	console.error(`${name}: ${value.toFixed(2)}`)
	;(samples[name] ??= []).push(value)
}
async function save() {
	result.metrics = Object.fromEntries(
		Object.entries(samples).map(([name, values]) => [name, summary(values)]),
	)
	await mkdir(dirname(values.out!), { recursive: true })
	await writeFile(values.out!, JSON.stringify(result, null, "\t") + "\n")
}
