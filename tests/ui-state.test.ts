import { expect, test } from "bun:test"
import { documentStats, statValue } from "../src/shared/document-stats"
import * as Effect from "effect/Effect"
import { TestClock } from "effect/testing"
import { makeSaveFeedback, saveIndicator } from "../src/shared/save-status"
import { fitPanel, placePanel } from "../src/client/ui/placement"

test("statistics exclude frontmatter and count unfinished sentences", () => {
	let source =
		"---\ntitle: Five irrelevant title words\n---\nHello world. One more sentence"
	expect(documentStats(source)).toEqual({
		words: 5,
		sentences: 2,
		tasks: 0,
		completedTasks: 0,
	})
	expect(documentStats("").words).toBe(0)
	expect(documentStats("---\ntitle: Empty\n---\n").sentences).toBe(0)
})

test("task metric includes checked and unchecked Markdown tasks", () => {
	let stats = documentStats(
		"- [ ] One\n* [x] Two\n+ [X] Three\n- Ordinary list item",
	)
	expect(statValue(stats, "tasks")).toBe("2 / 3")
	expect(statValue(stats, "hidden")).toBe("")
})

test("sentence metric ignores fenced code and link destinations", () => {
	expect(
		documentStats(
			"[Hello](https://example.com/path).\n```ts\nconsole.log('x. y!');\n```\nGoodbye",
		).sentences,
	).toBe(2)
})

test("local failures remain visible while writes are pending", () => {
	let state = {
		unsaved: true,
		pending: true,
		saveFailed: true,
		syncFailed: true,
	}
	expect(saveIndicator(state)).toEqual({
		text: "Could not save on this device",
		state: "error",
	})
	expect(saveIndicator({ ...state, saveFailed: false }).state).toBe("busy")
	expect(
		saveIndicator({ ...state, saveFailed: false, unsaved: false }).state,
	).toBe("error")
})

test("offline changes are saved locally and file conflicts need attention", () => {
	let state = {
		unsaved: false,
		pending: true,
		saveFailed: false,
		syncFailed: false,
	}
	expect(saveIndicator(state)).toEqual({
		text: "Saved on this device",
		state: "notice",
	})
	expect(saveIndicator({ ...state, pending: false }).state).toBe("quiet")
	for (let status of ["conflict", "reconnect", "failed"])
		expect(saveIndicator({ ...state, file: { status } }).state).toBe("error")
	expect(saveIndicator({ ...state, file: { status: "saved" } }).state).toBe(
		"quiet",
	)
})

test("panels flip above the trigger and stay within narrow viewports", () => {
	let anchor = { left: 270, right: 310, top: 400, bottom: 440 }
	let panel = { width: 200, height: 100 }
	let viewport = { width: 320, height: 480 }
	expect(placePanel(anchor, panel, viewport)).toEqual({
		x: 112,
		y: 296,
		side: "top",
	})
	expect(
		placePanel({ left: 20, right: 100, top: 0, bottom: 30 }, panel, viewport, {
			side: "top",
			align: "end",
		}),
	).toEqual({ x: 8, y: 34, side: "bottom" })
	expect(fitPanel({ x: -20, y: 900 }, panel, viewport)).toEqual({
		x: 8,
		y: 372,
	})
})

test("save feedback coalesces rapid writes, reports failures immediately, and releases timers", async () => {
	let rendered: string[] = []
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* Effect.scoped(
				Effect.gen(function* () {
					let feedback = yield* makeSaveFeedback(value =>
						rendered.push(value.text),
					)
					yield* feedback.update("one", { text: "Saving…", state: "busy" })
					yield* TestClock.adjust("400 millis")
					yield* feedback.update("one", { text: "Saved", state: "quiet" })
					yield* TestClock.adjust("400 millis")
					expect(rendered).toEqual(["Saved"])
					yield* feedback.update("one", { text: "Saving…", state: "busy" })
					yield* TestClock.adjust("800 millis")
					expect(rendered.at(-1)).toBe("Saving…")
					yield* feedback.update("one", { text: "Saved", state: "quiet" })
					yield* TestClock.adjust("500 millis")
					expect(rendered.at(-1)).toBe("Saving…")
					yield* feedback.update("one", { text: "Failed", state: "error" })
					yield* Effect.yieldNow
					expect(rendered.at(-1)).toBe("Failed")
					yield* feedback.update("two", {
						text: "Saving next document",
						state: "busy",
					})
					expect(rendered.at(-1)).toBe("Saved")
				}),
			)
			let count = rendered.length
			yield* TestClock.adjust("10 seconds")
			expect(rendered.length).toBe(count)
		}).pipe(Effect.provide(TestClock.layer())),
	)
})

test("side menus flip away from viewport edges", () => {
	let panel = { width: 200, height: 100 }
	let viewport = { width: 1000, height: 600 }
	expect(
		placePanel(
			{ left: 700, right: 900, top: 100, bottom: 136 },
			panel,
			viewport,
			{ side: "left" },
		),
	).toEqual({ x: 496, y: 100, side: "left" })
	expect(
		placePanel(
			{ left: 700, right: 900, top: 550, bottom: 586 },
			panel,
			viewport,
			{ side: "right" },
		),
	).toEqual({ x: 496, y: 492, side: "left" })
	expect(
		placePanel(
			{ left: 10, right: 110, top: 100, bottom: 136 },
			panel,
			viewport,
			{ side: "left" },
		),
	).toEqual({ x: 114, y: 100, side: "right" })
})
