import * as Effect from "effect/Effect"
import { Replica } from "../../src/shared/crdt"

let label = process.argv[2] ?? "candidate"
let source = "a".repeat(128 * 1024)
let replica = new Replica("fixture", "Disposable writer")
replica.edit("document", source)
let removal = replica.edit("document", "")
if (!removal) throw new Error("Missing deletion-heavy history")
let samples: { cooperative: boolean; milliseconds: number[] }[] = []
for (let cooperative of [false, true]) {
	let milliseconds: number[] = []
	for (let sample = 0; sample < 4; sample++) {
		Bun.gc(true)
		let started = performance.now()
		let copied = cooperative
			? await Effect.runPromise(replica.forkEffect("peer", "Peer"))
			: replica.fork("peer", "Peer")
		let duration = performance.now() - started
		copied.cancel("document", removal.id)
		if (copied.text("document") !== source || replica.text("document") !== "")
			throw new Error("Fork deletion/undo leaked into retained source")
		if (sample) milliseconds.push(duration)
	}
	samples.push({ cooperative, milliseconds })
}
console.log(
	JSON.stringify({
		label,
		characters: source.length,
		runtime: "Bun",
		scope:
			"Public Replica fork over 128KiB fully deleted history; cooperative mode uses Bun scheduler, not browser timing",
		samples,
	}),
)
