import * as Schema from "effect/Schema"
import { browser, browserBatch } from "../../../tests/browser-driver"

let localLarge = process.argv.includes("--local-large")
let session = localLarge
	? "viewport-connected-large"
	: "viewport-connected-journey"
let origin = process.argv[2] ?? "http://127.0.0.1:4331"
let Sample = Schema.Struct({
	handler: Schema.Number,
	frame: Schema.Number,
	characters: Schema.Number,
})
let Journey = Schema.Struct({
	size: Schema.Number,
	correct: Schema.Boolean,
	reopened: Schema.Boolean,
	synced: Schema.Boolean,
	samples: Schema.Array(Sample),
	workerMilliseconds: Schema.Array(Schema.Number),
	syncAttempted: Schema.Boolean,
})
let results: (typeof Journey.Type)[] = []
try {
	for (let size of localLarge ? [1048576] : [131072]) {
		let document = "connected-" + crypto.randomUUID()
		browser(
			session,
			"open",
			`${origin}/?mode=session&size=${size}&document=${document}`,
		)
		browser(session, "wait", "--fn", "Boolean(window.viewportSession)")
		browser(
			session,
			"eval",
			"window.expectedSource=window.viewportExperiment.value;window.connectedSamples=[]",
		)
		for (let position of [size, 0, size >>> 1]) {
			for (let repeat = 0; repeat < 3; repeat++) {
				browserBatch(session, [
					[
						"eval",
						`(()=>{window.viewportExperiment.select(${position});window.viewportExperiment.samples.length=0;window.expectedSource=window.expectedSource.slice(0,${position})+'x'+window.expectedSource.slice(${position});return true})()`,
					],
					["keyboard", "inserttext", "x"],
					[
						"wait",
						"--fn",
						"window.viewportSession.pending===0||Boolean(window.viewportSession.failure)",
					],
					[
						"eval",
						"(()=>{if(window.viewportSession.failure)throw Error(window.viewportSession.failure);if(window.viewportExperiment.value!==window.expectedSource)throw Error('Visible source differs');window.connectedSamples.push(window.viewportExperiment.samples.find(sample=>sample.kind==='insertText'))})()",
					],
				])
			}
		}
		let measured = browser(
			session,
			"eval",
			`({size:${size},samples:window.connectedSamples,workerMilliseconds:window.viewportSession.workerSamples})`,
		).result
		browser(
			session,
			"eval",
			"(async()=>{let state=await window.viewportSession.read();if(state.content!==window.expectedSource)throw Error('Worker source differs');return true})()",
		)
		if (!localLarge) {
			browser(session, "click", "#sync")
			browser(
				session,
				"wait",
				"--fn",
				"document.querySelector('output').textContent==='Synced'",
			)
		}
		browser(session, "reload")
		browser(session, "wait", "--fn", "Boolean(window.viewportSession)")
		let restored = browser(
			session,
			"eval",
			`(async()=>{let state=await window.viewportSession.read();return state.content===window.viewportExperiment.value&&state.content.length===${size}+9})()`,
		).result
		if (restored !== true) throw Error("Reload lost durable text")
		let measuredSchema = Schema.Struct({
			size: Schema.Number,
			samples: Schema.Array(Sample),
			workerMilliseconds: Schema.Array(Schema.Number),
		})
		let verified = Schema.decodeUnknownSync(measuredSchema)(measured)
		results.push({
			...verified,
			correct: true,
			reopened: true,
			synced: !localLarge,
			syncAttempted: !localLarge,
		})
		await Bun.write(
			import.meta.dir +
				(localLarge
					? "/connected-large-local-results.json"
					: "/connected-results.json"),
			JSON.stringify(results, null, 2) + "\n",
		)
	}
} finally {
	browser(session, "close")
}
console.log(JSON.stringify(results))
