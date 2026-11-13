import { expect, type Page } from "@playwright/test"
import { editor, openDocument, readContent, replaceContent } from "./adapter"
import { instrument } from "./metrics"
import { mkdir, writeFile } from "node:fs/promises"

export { measureReplay, withDeadline }

interface ReplayOptions {
	document: { id: string; title: string; content: string }
	edits: [number, number, string?][]
	cpu: number
	reset: boolean
	literalNewlines?: boolean
	finalText?: string
}

async function measureReplay(page: Page, options: ReplayOptions) {
	let { document, edits, cpu } = options
	let { cdp, wire, ensureHealthy } = await instrument(page, cpu)
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
	return {
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
