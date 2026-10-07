import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import { performanceFixture } from "./fixture"
import { FrameResponse, FrameText } from "./frame-data-model"
import type { EditPatch } from "./frame-data-model"

function summary(values: number[]) {
	let sorted = [...values].sort((left, right) => left - right)
	return {
		count: sorted.length,
		median: sorted[Math.floor(sorted.length / 2)],
		p95: sorted[Math.floor(sorted.length * 0.95)],
		max: sorted.at(-1),
	}
}
function patch(sequence: number, projection: FrameText): EditPatch {
	let length = projection.length
	let start =
		sequence % 3 === 0
			? 70
			: sequence % 3 === 1
				? Math.floor(length / 2)
				: length - 1
	let nearby = projection.window(Math.max(0, start - 1), 4)
	let offset = start ? 1 : 0
	let current = nearby.charCodeAt(offset),
		previous = nearby.charCodeAt(offset - 1)
	if (
		current >= 0xdc00 &&
		current <= 0xdfff &&
		previous >= 0xd800 &&
		previous <= 0xdbff
	)
		start--
	let character = projection.window(start, 2)
	return {
		kind: "edit",
		sequence,
		start,
		remove: sequence % 4 === 0 ? (Array.from(character)[0]?.length ?? 0) : 0,
		text: sequence % 5 === 0 ? "🧠" : "x",
	}
}
let results: unknown[] = []
for (let kilobytes of [128, 1024]) {
	let source = performanceFixture(kilobytes),
		text = new FrameText(source)
	let milliseconds: number[] = [],
		serializedBytes: number[] = []
	for (let sequence = 1; sequence <= 500; sequence++) {
		let edit = patch(sequence, text),
			started = performance.now()
		text.patch(edit)
		text.window(Math.max(0, edit.start - 80), 160)
		milliseconds.push(performance.now() - started)
		serializedBytes.push(JSON.stringify(edit).length)
		source =
			source.slice(0, edit.start) +
			edit.text +
			source.slice(edit.start + edit.remove)
	}
	if (text.text() !== source) throw Error("Bounded projection changed source")
	results.push({
		phase: "bounded-main-projection",
		kilobytes,
		milliseconds: summary(milliseconds),
		messageBytes: summary(serializedBytes),
	})
}
let sizes = process.env.FRAME_DATA_MIB === "1" ? [128, 1024] : [128]
for (let kilobytes of sizes) {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-frame-worker-"))
	let source = performanceFixture(kilobytes),
		text = new FrameText(source)
	let responses = await Effect.runPromise(
		Queue.unbounded<typeof FrameResponse.Type>(),
	)
	let worker = new Worker(
		new URL("./frame-data-worker.ts", import.meta.url).href,
	)
	worker.addEventListener("message", event =>
		Queue.offerUnsafe(
			responses,
			Schema.decodeUnknownSync(FrameResponse)(event.data),
		),
	)
	worker.addEventListener("error", event =>
		Queue.offerUnsafe(responses, { kind: "failure", message: event.message }),
	)
	async function next() {
		let response = await Effect.runPromise(
			Queue.take(responses).pipe(Effect.timeout("60 seconds")),
		)
		if (response.kind === "failure") throw Error(response.message)
		return response
	}
	try {
		let started = performance.now()
		if ((await next()).kind !== "listening")
			throw Error("Worker did not attach input listener")
		worker.postMessage({ kind: "open", source, directory })
		let ready = await next()
		if (ready.kind !== "ready" || ready.hash !== Bun.hash(source).toString())
			throw Error("Worker opening differs")
		let openMilliseconds = performance.now() - started
		let localMilliseconds: number[] = [],
			workerMilliseconds: number[] = [],
			timerDelays: number[] = []
		let last = performance.now()
		let timer = setInterval(() => {
			let now = performance.now()
			timerDelays.push(Math.max(0, now - last - 8))
			last = now
		}, 8)
		started = performance.now()
		try {
			for (let sequence = 1; sequence <= 24; sequence++) {
				let edit = patch(sequence, text),
					before = performance.now()
				text.patch(edit)
				worker.postMessage(edit)
				localMilliseconds.push(performance.now() - before)
			}
			for (let sequence = 1; sequence <= 24; sequence++) {
				let saved = await next()
				if (saved.kind !== "saved" || saved.sequence !== sequence)
					throw Error("Lost durable transaction")
				workerMilliseconds.push(saved.milliseconds)
			}
		} finally {
			clearInterval(timer)
		}
		let drainedMilliseconds = performance.now() - started
		await worker.terminate()
		worker = new Worker(new URL("./frame-data-worker.ts", import.meta.url).href)
		worker.addEventListener("message", event =>
			Queue.offerUnsafe(
				responses,
				Schema.decodeUnknownSync(FrameResponse)(event.data),
			),
		)
		worker.addEventListener("error", event =>
			Queue.offerUnsafe(responses, { kind: "failure", message: event.message }),
		)
		if ((await next()).kind !== "listening")
			throw Error("Worker did not attach input listener")
		worker.postMessage({ kind: "open", source, directory })
		let reopened = await next()
		if (
			reopened.kind !== "ready" ||
			reopened.hash !== Bun.hash(text.text()).toString()
		)
			throw Error("Durable reopen lost edits")
		worker.postMessage({ kind: "close" })
		await next()
		results.push({
			phase: "real-session-worker",
			kilobytes,
			openMilliseconds,
			localMilliseconds: summary(localMilliseconds),
			workerDurableMilliseconds: summary(workerMilliseconds),
			mainEightMillisecondTimerDelay: summary(timerDelays),
			drainedMilliseconds,
			persistedReopen: true,
			forceKilledAfterDurableAck: true,
		})
	} finally {
		await worker.terminate()
		await Effect.runPromise(Queue.shutdown(responses))
		await rm(directory, { recursive: true, force: true })
	}
}
console.log(
	JSON.stringify(
		{
			runtime: Bun.version,
			note: "Bun worker/SQLite experiment; not browser IndexedDB or a rendering measurement. Main projection stores UTF16 blocks, not CRDT atoms. Worker retains current full-source session.edit API.",
			results,
		},
		null,
		2,
	),
)
