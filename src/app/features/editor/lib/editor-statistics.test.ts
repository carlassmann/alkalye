import { ChangeSet, Text } from "@codemirror/state"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createInteractionWork } from "@/app/lib/interaction-work"
import {
	createEditorStatistics,
	type StatisticsWorker,
} from "./editor-statistics"
import { createStatisticsDocument } from "./statistics-document"
import { getStats } from "./count-statistics"
import type {
	StatisticsRequest,
	StatisticsResponse,
} from "./editor-statistics-protocol"

describe("editor statistics", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test("starts lazily, coalesces replacements, and drops stale computations and publications", async () => {
		let work = createInteractionWork(),
			worker = makeWorker()
		let make = vi.fn(() => worker)
		let source = Text.of(["one two"])
		let client = createEditorStatistics(source, make, work)
		expect(make).not.toHaveBeenCalled()
		let publish = vi.fn()
		client.subscribe(publish)
		work.interact()
		let first = ChangeSet.of({ from: 3, insert: " three" }, source.length)
		source = first.apply(source)
		client.update(first, source)
		await vi.advanceTimersByTimeAsync(99)
		expect(make).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(worker.requests).toEqual([
			{ type: "reset", revision: 1, content: "one three two" },
		])
		let second = ChangeSet.of(
			[
				{ from: 0, to: 3, insert: "ONE" },
				{ from: source.length, insert: "!" },
			],
			source.length,
		)
		source = second.apply(source)
		client.update(second, source)
		let third = ChangeSet.of({ from: 4, to: 9, insert: "👩🏽‍💻" }, source.length)
		source = third.apply(source)
		client.update(third, source)
		expect(worker.requests).toHaveLength(1)
		worker.reply()
		await vi.advanceTimersByTimeAsync(1)
		expect(worker.requests).toHaveLength(2)
		let request = worker.requests[1]
		expect(request?.type).toBe("replace")
		if (request?.type === "replace") {
			expect(request.baseRevision).toBe(1)
			expect(request.revision).toBe(3)
			expect(request.replacements).toHaveLength(3)
		}
		expect(publish.mock.calls).toEqual([[null]])
		worker.reply()
		// A result that was current when received becomes stale before idle publication.
		let fourth = ChangeSet.of(
			{ from: 0, to: source.length, insert: "newest" },
			source.length,
		)
		source = fourth.apply(source)
		client.update(fourth, source)
		await vi.advanceTimersByTimeAsync(1)
		expect(publish.mock.calls).toEqual([[null]])
		worker.reply()
		await vi.advanceTimersByTimeAsync(1)
		expect(publish).toHaveBeenLastCalledWith(getStats("newest"))
		client.dispose()
		expect(worker.terminate).toHaveBeenCalledOnce()
		expect(vi.getTimerCount()).toBe(0)
	})

	test("gates transfer and publication with bounded waits, then cancels everything on teardown", async () => {
		let work = createInteractionWork(),
			worker = makeWorker(),
			publish = vi.fn()
		let source = Text.of(["one"])
		let client = createEditorStatistics(source, () => worker, work)
		work.interact()
		client.subscribe(publish)
		for (let i = 0; i < 10; i++) {
			await vi.advanceTimersByTimeAsync(50)
			work.interact()
		}
		await vi.advanceTimersByTimeAsync(1)
		expect(worker.requests).toHaveLength(1)
		work.interact()
		worker.reply()
		await vi.advanceTimersByTimeAsync(99)
		expect(publish.mock.calls).toEqual([[null]])
		await vi.advanceTimersByTimeAsync(1)
		expect(publish).toHaveBeenLastCalledWith(getStats("one"))
		client.dispose()
		work.release()
		expect(vi.getTimerCount()).toBe(0)
	})

	test("retries one transient worker failure without another edit", async () => {
		let first = makeWorker(),
			second = makeWorker()
		let make = vi.fn().mockReturnValueOnce(first).mockReturnValue(second)
		let client = createEditorStatistics(
			Text.of(["recover without typing"]),
			make,
			createInteractionWork(),
		)
		let publish = vi.fn()
		client.subscribe(publish)
		await vi.advanceTimersByTimeAsync(1)
		first.onerror?.(new ErrorEvent("error"))
		await vi.advanceTimersByTimeAsync(1_001)
		expect(make).toHaveBeenCalledTimes(2)
		second.reply()
		await vi.advanceTimersByTimeAsync(1)
		expect(publish).toHaveBeenLastCalledWith(getStats("recover without typing"))
		client.dispose()
	})

	test("bounds retries and cancels recovery when the badge is hidden", async () => {
		let first = makeWorker(),
			second = makeWorker()
		let make = vi.fn().mockReturnValueOnce(first).mockReturnValue(second)
		let client = createEditorStatistics(
			Text.of(["text"]),
			make,
			createInteractionWork(),
		)
		client.subscribe(() => {})
		await vi.advanceTimersByTimeAsync(1)
		first.onerror?.(new ErrorEvent("error"))
		await vi.advanceTimersByTimeAsync(1_001)
		second.onmessageerror?.(new MessageEvent("messageerror"))
		await vi.advanceTimersByTimeAsync(20_000)
		expect(make).toHaveBeenCalledTimes(2)
		client.dispose()
		let hiddenWorker = makeWorker(),
			hiddenMake = vi.fn(() => hiddenWorker)
		let hiddenClient = createEditorStatistics(
			Text.of(["hidden"]),
			hiddenMake,
			createInteractionWork(),
		)
		let unsubscribe = hiddenClient.subscribe(() => {})
		await vi.advanceTimersByTimeAsync(1)
		hiddenWorker.onerror?.(new ErrorEvent("error"))
		unsubscribe()
		await vi.advanceTimersByTimeAsync(20_000)
		expect(hiddenMake).toHaveBeenCalledOnce()
		hiddenClient.dispose()
		expect(vi.getTimerCount()).toBe(0)
	})

	test("terminates a failed worker and resets from current content on the next edit", async () => {
		let work = createInteractionWork(),
			first = makeWorker(),
			second = makeWorker()
		let make = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
		let source = Text.of(["old"])
		let client = createEditorStatistics(source, make, work),
			publish = vi.fn()
		let unsubscribe = client.subscribe(publish)
		await vi.advanceTimersByTimeAsync(1)
		first.onerror?.(new ErrorEvent("error"))
		expect(first.terminate).toHaveBeenCalledOnce()
		let change = ChangeSet.of({ from: 0, to: 3, insert: "new content" }, 3)
		source = change.apply(source)
		client.update(change, source)
		await vi.advanceTimersByTimeAsync(1)
		expect(second.requests).toEqual([
			{ type: "reset", revision: 1, content: "new content" },
		])
		second.reply()
		await vi.advanceTimersByTimeAsync(1)
		expect(publish).toHaveBeenLastCalledWith(getStats("new content"))
		unsubscribe()
		expect(second.terminate).toHaveBeenCalledOnce()
		client.dispose()
	})

	test("worker preserves badge counting semantics and rejects a mismatched revision", () => {
		let worker = createStatisticsDocument()
		let content =
			"---\r\ntitle: Test\r\n---\r\n# Hello 世界.\n\n- [x] Done!\n- [ ] Next?\n```js\nhide.\n```\n`code.` [link](test) ![image](x)"
		expect(worker.update({ type: "reset", revision: 4, content })).toEqual({
			type: "stats",
			revision: 4,
			stats: getStats(content),
		})
		expect(getStats(content)).toEqual({
			words: "16",
			sentences: "4",
			tasks: "1 / 2",
		})
		expect(
			worker.update({
				type: "replace",
				revision: 6,
				baseRevision: 3,
				replacements: [],
			}),
		).toEqual({ type: "resync", revision: 6 })
		expect(
			worker.update({
				type: "replace",
				revision: 7,
				baseRevision: 4,
				replacements: [{ from: 0, to: content.length, inserted: "" }],
			}),
		).toEqual({
			type: "stats",
			revision: 7,
			stats: { words: "0", sentences: "0", tasks: "0 / 0" },
		})
	})
})

function makeWorker() {
	let document = createStatisticsDocument()
	let requests: StatisticsRequest[] = []
	let replied = 0
	let worker: StatisticsWorker & {
		requests: StatisticsRequest[]
		reply(): void
	} = {
		requests,
		onmessage: null,
		onerror: null,
		onmessageerror: null,
		postMessage(request) {
			requests.push(request)
		},
		terminate: vi.fn(),
		reply() {
			let request = requests[replied++]
			if (!request) throw new Error("No statistics request")
			worker.onmessage?.(
				new MessageEvent<StatisticsResponse>("message", {
					data: document.update(request),
				}),
			)
		},
	}
	return worker
}
