import { test, expect } from "bun:test"
import * as Effect from "effect/Effect"
import {
	documentStats,
	documentStatsEffect,
} from "../src/shared/document-stats"

let documents = [
	{
		source: "",
		counts: {
			words: 0,
			sentences: 0,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "   ",
		counts: {
			words: 0,
			sentences: 0,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "A. B! C?",
		counts: {
			words: 3,
			sentences: 3,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "A.B",
		counts: {
			words: 1,
			sentences: 1,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "---\ntitle: ignored words\n---\nOne two.",
		counts: {
			words: 2,
			sentences: 1,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "# Hello\n\n- [ ] Open.\n - [X] Done!\n- [x] Yes?",
		counts: {
			words: 12,
			sentences: 3,
			tasks: 3,
			completedTasks: 2,
		},
	},
	{
		source: "```ts\nHidden.\n```\nVisible.",
		counts: {
			words: 4,
			sentences: 1,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "~~~\nOne.\n~~~\nTwo!",
		counts: {
			words: 4,
			sentences: 1,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "```\nUnclosed.\nOne",
		counts: {
			words: 3,
			sentences: 2,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "`Hidden. code` Visible.",
		counts: {
			words: 3,
			sentences: 1,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "![Alt.](url) [Visible!](url)",
		counts: {
			words: 2,
			sentences: 1,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "[multi\nline.](url)",
		counts: {
			words: 2,
			sentences: 1,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "- [ ] A\n\n\t- [x] B\n + [X] C",
		counts: {
			words: 10,
			sentences: 1,
			tasks: 3,
			completedTasks: 2,
		},
	},
	{
		source: "First...\nSecond?! Third.",
		counts: {
			words: 3,
			sentences: 3,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "First.\t\t\n\nLast",
		counts: {
			words: 2,
			sentences: 2,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "😀 Arabic العربية.\n日本語!",
		counts: {
			words: 4,
			sentences: 2,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "##\nHeading\n#\t Hello",
		counts: {
			words: 4,
			sentences: 1,
			tasks: 0,
			completedTasks: 0,
		},
	},
	{
		source: "````\nA.\n```\nB.\n````\nC.",
		counts: {
			words: 6,
			sentences: 1,
			tasks: 0,
			completedTasks: 0,
		},
	},
]

test("document counts retain Markdown, Unicode, frontmatter and task semantics in both execution modes", async () => {
	for (let { source, counts } of documents) {
		expect(documentStats(source)).toEqual(counts)
		expect(await Effect.runPromise(documentStatsEffect(source))).toEqual(counts)
	}
	let source = "One two.\n- [ ] Open.\n- [X] Done!\n".repeat(32768)
	let expected = {
		words: 294912,
		sentences: 98304,
		tasks: 65536,
		completedTasks: 32768,
	}
	expect(documentStats(source)).toEqual(expected)
	expect(await Effect.runPromise(documentStatsEffect(source))).toEqual(expected)
})

test("large incomplete Markdown remains countable without regex backtracking", async () => {
	let sources = [
		{
			source: "`".repeat(200) + "\n" + "One two. ".repeat(32768),
			counts: { words: 65537, sentences: 32768, tasks: 0, completedTasks: 0 },
		},
		{
			source: "[".repeat(131072),
			counts: { words: 1, sentences: 1, tasks: 0, completedTasks: 0 },
		},
		{
			source: "![".repeat(65536),
			counts: { words: 1, sentences: 1, tasks: 0, completedTasks: 0 },
		},
		{
			source: "[a](".repeat(32768),
			counts: { words: 1, sentences: 1, tasks: 0, completedTasks: 0 },
		},
		{
			source: ".".repeat(131072) + "x",
			counts: { words: 1, sentences: 1, tasks: 0, completedTasks: 0 },
		},
		{
			source: "\n".repeat(131072),
			counts: { words: 0, sentences: 0, tasks: 0, completedTasks: 0 },
		},
	]
	for (let { source, counts } of sources) {
		expect(documentStats(source)).toEqual(counts)
		expect(await Effect.runPromise(documentStatsEffect(source))).toEqual(counts)
	}
})

test("synced task text recognizes every ECMAScript line boundary and many fence blocks", async () => {
	let taskSource = "x\r- [x] one\u2028- [ ] two\u2029- [X] three\r\n- [x] four"
	let counts = { words: 14, sentences: 1, tasks: 4, completedTasks: 3 }
	expect(documentStats(taskSource)).toEqual(counts)
	expect(await Effect.runPromise(documentStatsEffect(taskSource))).toEqual(
		counts,
	)
	let fences = "```\nhidden.\n```\n".repeat(32768) + "Visible."
	let expected = { words: 98305, sentences: 1, tasks: 0, completedTasks: 0 }
	expect(documentStats(fences)).toEqual(expected)
	expect(await Effect.runPromise(documentStatsEffect(fences))).toEqual(expected)
})
