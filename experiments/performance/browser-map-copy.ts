import * as Effect from "effect/Effect"
import { cooperative } from "../../src/platform/effects"
import { copyMapSteps } from "../../src/shared/collection-copy"
import { browserSchedulerLayer } from "../../src/client/scheduler"

interface IndexedAtom {
	target: string
	atom: { id: string; after: string; value: string }
}
interface CopySample {
	cooperative: boolean
	milliseconds: number
	stepMilliseconds: number
	largestStepMilliseconds: number
	steps: number
}
let fixture = new Map<string, IndexedAtom>()
let sourceRoot: IndexedAtom | undefined
function prepare(size: number) {
	fixture = new Map()
	let operation = "0001791400000000:000000:disposable-browser-copy-probe-000000"
	let after = ""
	for (let offset = 0; offset < size; offset++) {
		let id = operation + ":" + String(offset).padStart(8, "0")
		let value = { target: "doc", atom: { id, after, value: "a" } }
		fixture.set(id, value)
		if (!offset) sourceRoot = value
		after = id
	}
	return { size: fixture.size }
}
async function run(yielding: boolean) {
	let sample: CopySample = {
		cooperative: yielding,
		milliseconds: 0,
		stepMilliseconds: 0,
		largestStepMilliseconds: 0,
		steps: 0,
	}
	function* measuredSteps() {
		let steps = copyMapSteps(fixture, yielding)
		while (true) {
			let started = performance.now()
			let next = steps.next()
			let duration = performance.now() - started
			sample.steps++
			sample.stepMilliseconds += duration
			sample.largestStepMilliseconds = Math.max(
				sample.largestStepMilliseconds,
				duration,
			)
			if (next.done) return next.value
			yield
		}
	}
	let started = performance.now()
	let copied = await Effect.runPromise(
		cooperative("experiment.copy", measuredSteps).pipe(
			Effect.provide(browserSchedulerLayer),
		),
	)
	sample.milliseconds = performance.now() - started
	let first = copied.values().next().value
	if (first !== sourceRoot || copied.size !== fixture.size)
		throw new Error("Map value ownership or size changed")
	copied.set("new-independent-key", {
		target: "doc",
		atom: { id: "new-independent-key", after: "", value: "x" },
	})
	if (fixture.has("new-independent-key"))
		throw new Error("Copied map mutation changed source")
	return sample
}
declare global {
	interface Window {
		mapCopyProbe: { prepare: typeof prepare; run: typeof run }
	}
}
window.mapCopyProbe = { prepare, run }
document.body.textContent = "Disposable native Map copy probe ready."
