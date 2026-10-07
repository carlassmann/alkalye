import * as Effect from "effect/Effect"
import { Replica } from "../../../src/shared/crdt"
import { browserSchedulerLayer } from "../../../src/client/scheduler"
let dense: Replica | undefined
let expected = ""
function prepareDense(characters: number, replacements: number) {
	let source = "a".repeat(characters)
	dense = new Replica("dense")
	dense.edit("document", source)
	dense.fork("discarded-before-edits")
	let changes = Array.from({ length: replacements }, (_, offset) => ({
		start: Math.floor(((offset + 1) * characters) / (replacements + 1)),
		remove: 0,
		text: "X",
	}))
	let operation = dense.prepareReplacements("document", changes)
	if (!operation) throw new Error("Missing dense insertion")
	dense.apply([operation])
	expected = dense.text("document")
	if (expected.length !== characters + replacements)
		throw new Error("Dense insertion lost content")
	return { characters, replacements }
}
async function runDense() {
	if (!dense) throw new Error("Prepare dense source first")
	let source = dense
	let start = performance.now()
	let effect = source.forkEffect("dense-peer")
	let copied = await Effect.runPromise(
		typeof window === "undefined"
			? effect
			: effect.pipe(Effect.provide(browserSchedulerLayer)),
	)
	let milliseconds = performance.now() - start
	if (copied.text("document") !== expected)
		throw new Error("Dense fork lost edits")
	copied.edit("document", expected + "Y")
	if (source.text("document") !== expected)
		throw new Error("Dense peer changed source")
	return { milliseconds, characters: expected.length }
}
declare global {
	interface Window {
		denseProbe: { prepare: typeof prepareDense; run: typeof runDense }
	}
}
if (typeof window !== "undefined")
	window.denseProbe = { prepare: prepareDense, run: runDense }
export { prepareDense, runDense }
