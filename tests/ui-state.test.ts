import { expect, test } from "bun:test"
import { documentStats, statValue } from "../src/shared/document-stats"
import { saveIndicator } from "../src/shared/save-status"
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
