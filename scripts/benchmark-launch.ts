import {
	chromium,
	expect,
	type Browser,
	type BrowserContext,
	type Page,
} from "@playwright/test"
import JSZip from "jszip"
import { createAccount, signIn } from "../e2e/auth-helpers"

interface BenchmarkArgs {
	url: string
	docs: number
	kb: number
	runs: number
	label: string
	headed: boolean
	skipSeed: boolean
	remoteCacheMiss: boolean
	syncWaitMs: number
	passphrase?: string
	docId?: string
	docTitle?: string
	output: "text" | "json"
}

interface LaunchRun {
	run: number
	target: "home" | "doc"
	path: string
	readyMs: number
	sidebarReadyMs: number | null
	listItems: number
	route: string | null
	actualUrl: string
	expectedTitle: string | null
	actualTitle: string | null
	correctDoc: boolean | null
	correctRoute: boolean
	correctUrl: boolean
	sidebarTitleCorrect: boolean | null
	sidebarDocId: string | null
	resourceCount: number
	transferBytes: number
	encodedBytes: number
}

interface SeedResult {
	ms: number
	documents: SeededDocument[]
}

interface SeededDocument {
	id: string
	title: string
}

interface BenchmarkResult {
	label: string
	url: string
	docs: number
	kbPerDoc: number
	remoteCacheMiss: boolean
	cacheMode: "local-cache" | "credentials-only-fresh-context"
	seededDocuments: SeededDocument[]
	runs: LaunchRun[]
	seedMs: number | null
	medianReadyMs: number
	p95ReadyMs: number
	homeMedianReadyMs: number
	docMedianReadyMs: number | null
}

declare global {
	interface Window {
		__alkalyeReadyRoute?: string
	}
}

let args = parseArgs(process.argv.slice(2))
let browser = await chromium.launch({ headless: !args.headed })
let context = await createBrowserContext(browser, args)

try {
	let passphrase = args.passphrase
	if (args.remoteCacheMiss && !args.skipSeed && !passphrase) {
		passphrase = await createBenchmarkAccount(context)
	}

	let seedResult = args.skipSeed
		? buildSkippedSeedResult(args)
		: await seedDocuments(context, args)
	let seedMs = args.skipSeed ? null : seedResult.ms

	if (args.remoteCacheMiss) {
		if (!passphrase) {
			throw new Error(
				"--remote-cache-miss requires seeded account or --passphrase",
			)
		}
		await context.close()
	}
	let remoteStorageState: BrowserStorageState | undefined
	if (args.remoteCacheMiss) {
		if (!passphrase) {
			throw new Error("--remote-cache-miss requires a passphrase")
		}
		remoteStorageState = await createCredentialsOnlyStorageState(
			browser,
			args,
			passphrase,
		)
	}

	let runs: LaunchRun[] = []
	let targetDocument = seedResult.documents.at(-1)

	for (let run = 1; run <= args.runs; run++) {
		if (args.remoteCacheMiss) {
			if (!remoteStorageState) {
				throw new Error("--remote-cache-miss requires credentials")
			}
			console.error(`measuring run ${run} /app`)
			runs.push(
				await measureFreshContextLaunch(
					browser,
					args,
					remoteStorageState,
					run,
					"home",
					"/app",
					null,
				),
			)
			if (targetDocument) {
				console.error(`measuring run ${run} /app/doc/${targetDocument.id}`)
				runs.push(
					await measureFreshContextLaunch(
						browser,
						args,
						remoteStorageState,
						run,
						"doc",
						`/app/doc/${targetDocument.id}`,
						targetDocument.title,
					),
				)
			}
			continue
		}

		console.error(`measuring run ${run} /app`)
		runs.push(await measureLaunch(context, run, "home", "/app", null))
		if (targetDocument) {
			console.error(`measuring run ${run} /app/doc/${targetDocument.id}`)
			runs.push(
				await measureLaunch(
					context,
					run,
					"doc",
					`/app/doc/${targetDocument.id}`,
					targetDocument.title,
				),
			)
		}
	}

	let result = buildResult(args, seedMs, seedResult.documents, runs)
	printResult(result, args.output)
} finally {
	if (!args.remoteCacheMiss) await context.close()
	await browser.close()
}

type BrowserStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>

async function createBrowserContext(
	browser: Browser,
	args: BenchmarkArgs,
	storageState?: BrowserStorageState,
) {
	let context = await browser.newContext({
		baseURL: args.url,
		ignoreHTTPSErrors: true,
		permissions: ["clipboard-read", "clipboard-write"],
		serviceWorkers: "block",
		storageState,
	})
	await context.addInitScript(() => {
		let originalMark = performance.mark.bind(performance)
		let originalMeasure = performance.measure.bind(performance)

		performance.mark = (name, options) => {
			if (options && "detail" in options) {
				return originalMark(name, { ...options, detail: undefined })
			}
			return originalMark(name, options)
		}

		performance.measure = (name, startOrMeasureOptions, endMark) => {
			if (
				startOrMeasureOptions &&
				typeof startOrMeasureOptions === "object" &&
				"detail" in startOrMeasureOptions
			) {
				return originalMeasure(name, {
					...startOrMeasureOptions,
					detail: undefined,
				})
			}
			return originalMeasure(name, startOrMeasureOptions, endMark)
		}
	})
	return context
}

async function createCredentialsOnlyStorageState(
	browser: Browser,
	args: BenchmarkArgs,
	passphrase: string,
) {
	let authContext = await createBrowserContext(browser, args)
	try {
		await signInBenchmarkAccount(authContext, passphrase)
		return await authContext.storageState()
	} finally {
		await authContext.close()
	}
}

async function measureFreshContextLaunch(
	browser: Browser,
	args: BenchmarkArgs,
	storageState: BrowserStorageState,
	run: number,
	target: "home" | "doc",
	path: string,
	expectedTitle: string | null,
) {
	let context = await createBrowserContext(browser, args, storageState)
	try {
		return await measureLaunch(context, run, target, path, expectedTitle)
	} finally {
		await context.close()
	}
}

async function createBenchmarkAccount(context: BrowserContext) {
	let page = await context.newPage()
	let account = await createAccount(page)
	await page.close()
	return account.passphrase
}

async function signInBenchmarkAccount(
	context: BrowserContext,
	passphrase: string,
) {
	let page = await context.newPage()
	await signIn(page, { passphrase })
	await page.close()
}

function buildSkippedSeedResult(args: BenchmarkArgs): SeedResult {
	let documents =
		args.docId && args.docTitle
			? [{ id: args.docId, title: args.docTitle }]
			: []

	return {
		ms: 0,
		documents,
	}
}

async function seedDocuments(
	context: BrowserContext,
	args: BenchmarkArgs,
): Promise<SeedResult> {
	let page = await context.newPage()
	let importErrors: string[] = []
	page.on("console", message => {
		if (
			message.type() === "error" &&
			message.text().startsWith("Import failed")
		) {
			importErrors.push(message.text())
		}
	})
	page.on("pageerror", error => {
		importErrors.push(error.message)
	})
	let start = performance.now()

	await page.goto("/app")
	await waitForReady(page)
	await expect(page.locator('[data-testid="doc-search-input"]')).toBeVisible({
		timeout: 60_000,
	})
	await expect
		.poll(
			async function getInitialDocCount() {
				return page.locator('[data-testid="doc-list-item"]').count()
			},
			{ timeout: 60_000 },
		)
		.toBeGreaterThan(0)

	console.error(`building zip with ${args.docs} docs`)
	let zip = await buildBenchmarkZip(args)
	console.error(`importing zip with ${args.docs} docs`)

	let input = page.locator('input[type="file"][accept*=".zip"]').first()
	await input.setInputFiles({
		name: "alkalye-benchmark.zip",
		mimeType: "application/zip",
		buffer: zip,
	})
	await waitForImportComplete(page, args)
	if (importErrors.length > 0) {
		throw new Error(`Import failed: ${importErrors.join(" | ")}`)
	}

	let target = await waitForImportedDocument(page, buildTitle(args.docs), args)
	await page.waitForTimeout(getPostImportSettleMs(args))

	if (args.remoteCacheMiss) {
		await page.waitForTimeout(args.syncWaitMs)
	}

	await page.close()
	return {
		ms: Math.round(performance.now() - start),
		documents: [target],
	}
}

async function measureLaunch(
	context: BrowserContext,
	run: number,
	target: "home" | "doc",
	path: string,
	expectedTitle: string | null,
) {
	let page = await context.newPage()
	let cdp = await context.newCDPSession(page)
	await cdp.send("Network.enable")
	await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
	let pageErrors: string[] = []
	page.on("pageerror", error => {
		pageErrors.push(error.message)
	})
	await page.goto("about:blank")

	let start = performance.now()
	await page.goto(path, { waitUntil: "domcontentloaded" })
	try {
		await waitForReady(page)
	} catch (error) {
		let title = await page.title().catch(() => "")
		let url = page.url()
		let body = await page
			.locator("body")
			.innerText()
			.catch(() => "")
		await page.close()
		let message = error instanceof Error ? error.message : String(error)
		throw new Error(
			`Timed out waiting for ready on ${target} ${path}; url=${url}; title=${title}; body=${body.slice(0, 500)}; pageErrors=${pageErrors.join(" | ")}; ${message}`,
		)
	}
	let readyMs = Math.round(performance.now() - start)
	if (expectedTitle) {
		await expect(page).toHaveTitle(expectedTitle, { timeout: 60_000 })
	}
	let actualTitle = expectedTitle ? await page.title() : null
	let sidebarReadyMs: number | null = null
	let sidebarTitleCorrect: boolean | null = null
	let sidebarDocId: string | null = null

	if (expectedTitle) {
		await page.locator('[data-testid="doc-search-input"]').fill(expectedTitle)
		await expect
			.poll(
				async function getDocId() {
					sidebarDocId = await findVisibleDocumentId(page, expectedTitle)
					return sidebarDocId
				},
				{ timeout: 60_000 },
			)
			.toMatch(/^co_/)
		sidebarReadyMs = Math.round(performance.now() - start)
	}

	let actualUrl = page.url()
	let stats = await page.evaluate(() => {
		let resources = performance
			.getEntriesByType("resource")
			.filter(entry => entry instanceof PerformanceResourceTiming)

		let transferBytes = resources.reduce((total, entry) => {
			return total + entry.transferSize
		}, 0)

		let encodedBytes = resources.reduce((total, entry) => {
			return total + entry.encodedBodySize
		}, 0)

		return {
			route: window.__alkalyeReadyRoute ?? null,
			resourceCount: resources.length,
			transferBytes,
			encodedBytes,
		}
	})
	let expectedDocId = target === "doc" ? path.split("/").at(-1) : null
	let correctRoute = stats.route === "personal-doc"
	let actualPath = new URL(actualUrl).pathname
	let correctUrl = expectedDocId
		? actualPath.endsWith(`/doc/${expectedDocId}`)
		: actualPath.includes("/app/doc/")
	let correctDoc = expectedTitle ? actualTitle === expectedTitle : null
	sidebarTitleCorrect = expectedTitle
		? expectedDocId
			? sidebarDocId === expectedDocId
			: Boolean(sidebarDocId)
		: null

	if (!correctRoute || !correctUrl || correctDoc === false) {
		await page.close()
		throw new Error(
			`Unexpected launch target for ${target} ${path}; url=${actualUrl}; route=${stats.route}; title=${actualTitle}; expectedTitle=${expectedTitle}`,
		)
	}

	if (expectedDocId && sidebarTitleCorrect === false) {
		await page.close()
		throw new Error(
			`Sidebar resolved wrong doc for ${target} ${path}; sidebarDocId=${sidebarDocId}; expectedDocId=${expectedDocId}`,
		)
	}

	let listItems = await page.locator('[data-testid="doc-list-item"]').count()
	await page.close()

	return {
		run,
		target,
		path,
		readyMs,
		sidebarReadyMs,
		listItems,
		actualUrl,
		expectedTitle,
		actualTitle,
		correctDoc,
		correctRoute,
		correctUrl,
		sidebarTitleCorrect,
		sidebarDocId,
		...stats,
	}
}

async function waitForReady(page: Page) {
	await page.waitForFunction(() => {
		return document.body.getAttribute("data-alkalye-ready") === "true"
	})
}

function buildResult(
	args: BenchmarkArgs,
	seedMs: number | null,
	seededDocuments: SeededDocument[],
	runs: LaunchRun[],
): BenchmarkResult {
	let readyTimes = runs.map(run => run.readyMs)
	let homeReadyTimes = runs
		.filter(run => run.target === "home")
		.map(run => run.readyMs)
	let docReadyTimes = runs
		.filter(run => run.target === "doc")
		.map(run => run.readyMs)

	return {
		label: args.label,
		url: args.url,
		docs: args.docs,
		kbPerDoc: args.kb,
		remoteCacheMiss: args.remoteCacheMiss,
		cacheMode: args.remoteCacheMiss
			? "credentials-only-fresh-context"
			: "local-cache",
		seededDocuments,
		runs,
		seedMs,
		medianReadyMs: percentile(readyTimes, 0.5),
		p95ReadyMs: percentile(readyTimes, 0.95),
		homeMedianReadyMs: percentile(homeReadyTimes, 0.5),
		docMedianReadyMs:
			docReadyTimes.length > 0 ? percentile(docReadyTimes, 0.5) : null,
	}
}

function printResult(result: BenchmarkResult, output: "text" | "json") {
	if (output === "json") {
		console.log(JSON.stringify(result, null, 2))
		return
	}

	console.log(`${result.label}: ${result.medianReadyMs}ms median ready`)
	console.log(`cache mode: ${result.cacheMode}`)
	console.log(`home median: ${result.homeMedianReadyMs}ms`)
	if (result.docMedianReadyMs !== null) {
		console.log(`doc median: ${result.docMedianReadyMs}ms`)
	}
	console.log(`p95: ${result.p95ReadyMs}ms`)
	if (result.seedMs !== null) console.log(`seed: ${result.seedMs}ms`)
	console.log(JSON.stringify(result, null, 2))
}

function buildBody(index: number, kb: number) {
	let targetBytes = kb * 1024
	let line = `Benchmark body ${index}: denormalized title launch fixture.\n`
	let body = ""

	while (body.length < targetBytes) {
		body += line
	}

	return body
}

function buildContent(index: number, kb: number) {
	let tags = index % 5 === 0 ? "bench, launch" : "bench"
	let path = index % 10 === 0 ? "path: bench/folder\n" : ""

	return `---
${path}tags: ${tags}
---

# ${buildTitle(index)}

${buildBody(index, kb)}`
}

function buildTitle(index: number) {
	return `Benchmark ${index.toString().padStart(4, "0")}`
}

async function buildBenchmarkZip(args: BenchmarkArgs) {
	let zip = new JSZip()

	for (let index = 1; index <= args.docs; index++) {
		zip.file(`${buildTitle(index)}.md`, buildContent(index, args.kb))
	}

	return zip.generateAsync({
		type: "nodebuffer",
		compression: "DEFLATE",
	})
}

async function waitForImportedDocument(
	page: Page,
	title: string,
	args: BenchmarkArgs,
): Promise<SeededDocument> {
	await page.locator('[data-testid="doc-search-input"]').fill(title)

	await expect
		.poll(
			async function getDocId() {
				return findVisibleDocumentId(page, title)
			},
			{ timeout: Math.max(120_000, args.docs * 1_000) },
		)
		.toMatch(/^co_/)

	let id = await findVisibleDocumentId(page, title)
	if (!id) throw new Error(`Could not resolve imported doc id for ${title}`)

	return { id, title }
}

async function waitForImportComplete(page: Page, args: BenchmarkArgs) {
	await page.waitForFunction(
		() => {
			let input = document.querySelector<HTMLInputElement>(
				'input[type="file"][accept*=".zip"]',
			)
			return input?.value === ""
		},
		undefined,
		{ timeout: Math.max(120_000, args.docs * 1_000) },
	)
}

function getPostImportSettleMs(args: BenchmarkArgs) {
	return Math.min(30_000, Math.max(2_000, args.docs * 100))
}

async function findVisibleDocumentId(page: Page, title: string) {
	return page
		.locator('[data-testid="doc-list-item"]')
		.evaluateAll((rows, expectedTitle) => {
			for (let row of rows) {
				if (row.getAttribute("data-doc-title") === expectedTitle) {
					return row.getAttribute("data-doc-id") ?? ""
				}
			}
			return ""
		}, title)
}

function percentile(values: number[], percentileValue: number) {
	let sorted = [...values].sort(function sortNumbers(left, right) {
		return left - right
	})
	let index = Math.ceil(sorted.length * percentileValue) - 1
	return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0
}

function parseArgs(rawArgs: string[]): BenchmarkArgs {
	let parsed: BenchmarkArgs = {
		url:
			process.env.PLAYWRIGHT_BASE_URL ?? "https://web-main-alkalye.localhost",
		docs: 100,
		kb: 32,
		runs: 5,
		label: "launch",
		headed: false,
		skipSeed: false,
		remoteCacheMiss: false,
		syncWaitMs: 30_000,
		output: "text",
	}

	for (let index = 0; index < rawArgs.length; index++) {
		let arg = rawArgs[index]

		if (arg === "--headed") parsed.headed = true
		else if (arg === "--skip-seed") parsed.skipSeed = true
		else if (arg === "--remote-cache-miss") parsed.remoteCacheMiss = true
		else if (arg === "--json") parsed.output = "json"
		else if (arg === "--url") parsed.url = requireValue(rawArgs, ++index, arg)
		else if (arg === "--docs")
			parsed.docs = parsePositiveInt(rawArgs, ++index, arg)
		else if (arg === "--kb") parsed.kb = parsePositiveInt(rawArgs, ++index, arg)
		else if (arg === "--runs")
			parsed.runs = parsePositiveInt(rawArgs, ++index, arg)
		else if (arg === "--label")
			parsed.label = requireValue(rawArgs, ++index, arg)
		else if (arg === "--passphrase")
			parsed.passphrase = requireValue(rawArgs, ++index, arg)
		else if (arg === "--doc-id")
			parsed.docId = requireValue(rawArgs, ++index, arg)
		else if (arg === "--doc-title")
			parsed.docTitle = requireValue(rawArgs, ++index, arg)
		else if (arg === "--sync-wait-ms")
			parsed.syncWaitMs = parsePositiveInt(rawArgs, ++index, arg)
		else if (arg === "--help") printHelpAndExit()
		else throw new Error(`Unknown argument: ${arg}`)
	}

	return parsed
}

function requireValue(rawArgs: string[], index: number, flag: string) {
	let value = rawArgs[index]
	if (!value) throw new Error(`${flag} requires a value`)
	return value
}

function parsePositiveInt(rawArgs: string[], index: number, flag: string) {
	let value = Number.parseInt(requireValue(rawArgs, index, flag), 10)
	if (!Number.isFinite(value) || value < 1) {
		throw new Error(`${flag} requires a positive integer`)
	}
	return value
}

function printHelpAndExit() {
	console.log(`Usage: bun run bench:launch [options]

Options:
  --url <url>       App URL. Defaults to PLAYWRIGHT_BASE_URL or local work URL.
  --docs <count>    Documents to seed. Default: 100.
  --kb <count>      Body size per document. Default: 32.
  --runs <count>    Cold /app measurements. Default: 5.
  --label <name>    Result label. Default: launch.
  --skip-seed       Reuse existing browser context data.
  --doc-id <id>     Direct doc target for --skip-seed.
  --doc-title <t>   Expected direct doc title for --skip-seed.
  --remote-cache-miss  Measure with credentials but no Jazz IndexedDB cache.
  --passphrase <p>  Sign in for --remote-cache-miss with --skip-seed.
  --sync-wait-ms <n>  Wait after seed before fresh sign-in. Default: 30000.
  --json            Print only JSON.
  --headed          Show browser.`)
	process.exit(0)
}
