import { expect, type Page } from "@playwright/test"
import { editor, openDocument, readContent, replaceContent } from "./adapter"
import { instrument } from "./metrics"
import { mkdir, writeFile } from "node:fs/promises"
import type { MarkdownSync } from "../../src/app/features/documents/lib/codemirror-sync"
import type { Database } from "../../src/app/features/documents/lib/library"

export { measureReplay, withDeadline }

interface ReplayOptions {
	document: { id: string; title: string; content: string }
	edits: [number, number, string?][]
	cpu: number
	reset: boolean
	literalNewlines?: boolean
	finalText?: string
	verifyPersistence?: boolean
	flushWrites?: boolean
}

async function measureReplay(page: Page, options: ReplayOptions) {
	let { document, edits, cpu } = options
	let { cdp, wire, ensureHealthy, profileWorkers } = await instrument(page, cpu)
	await openDocument(page, document)
	if (options.reset) {
		await expect
			.poll(
				async () => (await readContent(page)).startsWith(document.content),
				{ timeout: 120_000 },
			)
			.toBe(true)
		await replaceContent(page, document.content)
	} else {
		await expect
			.poll(() => readContent(page), { timeout: 120_000 })
			.toBe(document.content)
		await editor(page).focus()
		await page.keyboard.press("ControlOrMeta+Home")
	}
	await page.waitForTimeout(3000)
	await page.evaluate(() => {
		window.__bench.paint = []
		window.__bench.events = []
		window.__bench.longTasks = []
	})
	let profileDirectory = process.env.BENCH_PROFILE_DIR
	let stopWorkerProfiles = profileDirectory ? await profileWorkers() : undefined
	if (profileDirectory) {
		await cdp.send("Profiler.enable")
		await cdp.send("Profiler.start")
	}
	let before = { ...wire }
	let cursor = 0
	let expected: string[] = []
	let dispatchToPaint: number[] = []
	for (let [position, remove, insert = ""] of edits) {
		while (cursor < position) {
			await page.keyboard.press("ArrowRight")
			cursor++
		}
		while (cursor > position) {
			await page.keyboard.press("ArrowLeft")
			cursor--
		}
		if (insert.includes("\n") && options.literalNewlines) {
			await page.evaluate(text => navigator.clipboard.writeText(text), insert)
		}
		let inputStarted = performance.now()
		for (let i = 0; i < remove; i++) await page.keyboard.press("Delete")
		if (insert) {
			if (/^[\x20-\x7e]+$/.test(insert)) await page.keyboard.type(insert)
			else if (insert.includes("\n") && options.literalNewlines)
				await page.keyboard.press("ControlOrMeta+Shift+V")
			else await page.keyboard.insertText(insert)
		}
		cursor += insert.length
		expected.splice(position, remove, ...insert)
		await page.evaluate(
			() =>
				new Promise<void>(resolve =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				),
		)
		dispatchToPaint.push(performance.now() - inputStarted)
		if (dispatchToPaint.length % 50 === 0)
			console.error(
				`${document.title}: ${dispatchToPaint.length}/${edits.length} edits`,
			)
	}
	await page.waitForTimeout(3000)
	let metrics = await page.evaluate(() => window.__bench)
	let actualContent = await readContent(page)
	let expectedContent = expected.join("") + document.content
	if (profileDirectory) {
		await stopWorkerProfiles?.(profileDirectory, document.title)
		let { profile } = await cdp.send("Profiler.stop")
		await mkdir(profileDirectory, { recursive: true })
		await writeFile(
			`${profileDirectory}/${document.title}.cpuprofile`,
			JSON.stringify(profile),
		)
	}
	if (actualContent !== expectedContent) {
		let offset = 0
		while (
			offset < Math.min(actualContent.length, expectedContent.length) &&
			actualContent[offset] === expectedContent[offset]
		)
			offset++
		if (profileDirectory) {
			await writeFile(`${profileDirectory}/actual.txt`, actualContent)
			await writeFile(`${profileDirectory}/expected.txt`, expectedContent)
		}
		throw new Error(
			`Trace replay diverged: ${document.title}, offset ${offset}, lengths ${actualContent.length}/${expectedContent.length}, actual ${JSON.stringify(actualContent.slice(Math.max(0, offset - 40), offset + 80))}, expected ${JSON.stringify(expectedContent.slice(Math.max(0, offset - 40), offset + 80))}`,
		)
	}
	if (
		options.finalText !== undefined &&
		expected.join("") !== options.finalText
	)
		throw new Error("Full trace differs from upstream finalText")

	let heap = await cdp.send("Runtime.getHeapUsage")
	ensureHealthy()
	if (options.verifyPersistence) {
		console.error("Verifying committed text after reload")
		if (options.flushWrites)
			await withDeadline(flushWrites(page), 120_000, "Pending text writes")
		await openDocument(page, document)
		await expect
			.poll(() => readContent(page), { timeout: 120_000 })
			.toBe(expectedContent)
	}
	return {
		persistenceVerified: options.verifyPersistence === true,
		paint: metrics.paint,
		events: metrics.events,
		dispatchToPaint,
		longTaskCount: metrics.longTasks.length,
		longTaskTotalMs: metrics.longTasks.reduce((a, b) => a + b, 0),
		sentBytesPerEdit:
			(wire.sent - before.sent + wire.httpSent - before.httpSent) /
			edits.length,
		receivedWsBytesPerEdit: (wire.received - before.received) / edits.length,
		jsHeapBytes: heap.usedSize,
	}
}

async function flushWrites(page: Page) {
	await page.evaluate(async () => {
		type Fiber = {
			return?: Fiber | null
			memoizedProps?: { sync?: MarkdownSync; value?: { db?: Database } }
		}
		let editor = document.querySelector('[data-testid="doc-editor"]')
		if (!editor) throw new Error("Document editor missing")
		let key = Object.keys(editor).find(name => name.startsWith("__reactFiber$"))
		if (!key) throw new Error("React editor root missing")
		let fiber: Fiber | null | undefined = Reflect.get(editor, key)
		let binding: MarkdownSync | undefined
		let db: Database | undefined
		while (fiber) {
			binding ??= fiber.memoizedProps?.sync
			db ??= fiber.memoizedProps?.value?.db
			fiber = fiber.return
		}
		if (!binding || !db) throw new Error("Jazz editor binding missing")
		await binding.whenIdle()
		await db.waitForSync({ timeoutMs: 120_000 })
	})
}

async function withDeadline<T>(
	operation: Promise<T>,
	milliseconds: number,
	label: string,
) {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() =>
						reject(new Error(`${label} exceeded ${milliseconds} ms deadline`)),
					milliseconds,
				)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}
