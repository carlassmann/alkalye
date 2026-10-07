import * as Effect from "effect/Effect"
import { frontmatter } from "./markdown"

export type StatsUnit = "words" | "sentences" | "tasks" | "hidden"
export let statsUnits: readonly StatsUnit[] = [
	"words",
	"sentences",
	"tasks",
	"hidden",
]
export interface DocumentStats {
	words: number
	sentences: number
	tasks: number
	completedTasks: number
}
export function documentStats(source: string): DocumentStats {
	let steps = countDocument(source)
	let step = steps.next()
	while (!step.done) step = steps.next()
	return step.value
}
export function documentStatsEffect(source: string) {
	return Effect.gen(function* () {
		let steps = countDocument(source)
		let step = steps.next()
		while (!step.done) {
			yield* Effect.yieldNow
			step = steps.next()
		}
		return step.value
	})
}
function* countDocument(source: string): Generator<void, DocumentStats> {
	let body = frontmatter(source).body
	yield
	let prose = yield* withoutFences(body)
	yield
	prose = prose.replace(/`[^`\n]+`/g, "")
	yield
	prose = yield* replaceLinks(prose, true)
	yield
	prose = yield* replaceLinks(prose, false)
	yield
	prose = prose.replace(/^#+\s*/gm, "")
	yield
	let words = 0
	let wordPattern = /\S+/g
	while (wordPattern.exec(body)) {
		words++
		if (words % 2048 === 0) yield
	}
	yield
	let sentences = 0
	let start = 0
	let separators = 0
	for (let match of prose.matchAll(/[.!?]+/g)) {
		let end = match.index + match[0].length
		if (end === prose.length || /\s/.test(prose.charAt(end))) {
			if (/\S/.test(prose.slice(start, match.index))) sentences++
			start = Math.min(prose.length, end + 1)
		}
		if (++separators % 2048 === 0) yield
	}
	if (/\S/.test(prose.slice(start))) sentences++
	yield
	let tasks = 0
	let completedTasks = 0
	let candidates = 0
	let lineEnd = -1
	let firstText = -1
	let lines = 0
	let lineBreaks = /[\n\r\u2028\u2029]/g
	for (let task of body.matchAll(/[-*+]\s+\[([ xX])\]/g)) {
		while (task.index > lineEnd) {
			let lineStart = lineEnd + 1
			lineEnd = lineBreaks.exec(body)?.index ?? body.length
			let text = /\S/.exec(body.slice(lineStart, lineEnd))
			firstText = text ? lineStart + text.index : -1
			if (++lines % 2048 === 0) yield
		}
		if (task.index === firstText) {
			tasks++
			if (task[1] !== " ") completedTasks++
		}
		if (++candidates % 2048 === 0) yield
	}
	return { words, sentences, tasks, completedTasks }
}
interface FenceRun {
	start: number
	length: number
	marker: string
	backticks: number
	tildes: number
}
function* withoutFences(source: string): Generator<void, string> {
	let runs: FenceRun[] = []
	for (let match of source.matchAll(/`+|~+/g)) {
		runs.push({
			start: match.index,
			length: match[0].length,
			marker: match[0][0] ?? "",
			backticks: 0,
			tildes: 0,
		})
		if (runs.length % 2048 === 0) yield
	}
	let backticks = 0
	let tildes = 0
	for (let index = runs.length - 1; index >= 0; index--) {
		let run = runs[index]
		if (!run) continue
		if (run.marker === "`") backticks = Math.max(backticks, run.length)
		else tildes = Math.max(tildes, run.length)
		run.backticks = backticks
		run.tildes = tildes
		if (index % 2048 === 0) yield
	}
	let pieces: string[] = []
	let cursor = 0
	let lineEnd = -1
	let tailStart = 0
	let removed = 0
	for (let index = 0; index < runs.length; index++) {
		if (index % 2048 === 0) yield
		let run = runs[index]
		if (!run || run.start < cursor || run.length < 3) continue
		if (run.start > lineEnd) {
			lineEnd = source.indexOf("\n", run.start)
			tailStart = index + 1
		}
		if (lineEnd < 0) break
		while (runs[tailStart] && (runs[tailStart]?.start ?? Infinity) < lineEnd) {
			tailStart++
			if (tailStart % 2048 === 0) yield
		}
		let tail = tailStart
		let remaining = runs[tail]
		let available =
			run.marker === "`" ? remaining?.backticks : remaining?.tildes
		let captured = Math.min(run.length, available ?? 0)
		if (captured < 3) continue
		let closing: FenceRun | undefined
		for (; tail < runs.length; tail++) {
			let candidate = runs[tail]
			if (candidate?.marker === run.marker && candidate.length >= captured) {
				closing = candidate
				break
			}
			if (tail % 2048 === 0) yield
		}
		if (!closing) continue
		pieces.push(source.slice(cursor, run.start))
		let closingEnd = source.indexOf("\n", closing.start)
		cursor = closingEnd < 0 ? source.length : closingEnd + 1
		index = tail
		lineEnd = closingEnd
		if (++removed % 2048 === 0) yield
	}
	pieces.push(source.slice(cursor))
	return pieces.join("")
}
function* replaceLinks(
	source: string,
	images: boolean,
): Generator<void, string> {
	let pieces: string[] = []
	let cursor = 0
	let search = 0
	let attempts = 0
	while (true) {
		let closingLabel = source.indexOf("](", search)
		if (closingLabel < 0) break
		let labelBoundary = Math.max(
			cursor,
			source.lastIndexOf("]", closingLabel - 1) + 1,
		)
		let prefix = images ? "![" : "["
		let label = source.slice(labelBoundary, closingLabel).indexOf(prefix)
		if (label < 0 || (!images && labelBoundary + label + 1 === closingLabel)) {
			search = closingLabel + 2
		} else {
			let end = source.indexOf(")", closingLabel + 2)
			if (end < 0) break
			let start = labelBoundary + label
			pieces.push(source.slice(cursor, start))
			if (!images) pieces.push(source.slice(start + 1, closingLabel))
			cursor = end + 1
			search = cursor
		}
		if (++attempts % 2048 === 0) yield
	}
	pieces.push(source.slice(cursor))
	return pieces.join("")
}
export function statValue(stats: DocumentStats, unit: StatsUnit) {
	return unit === "hidden"
		? ""
		: unit === "tasks"
			? `${stats.completedTasks} / ${stats.tasks}`
			: String(stats[unit])
}
