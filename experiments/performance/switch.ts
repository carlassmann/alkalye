import * as Schema from "effect/Schema"
import { browser, evaluate } from "../../tests/browser-driver"
let Configuration = Schema.Array(
	Schema.Struct({
		kind: Schema.Literal("rewrite"),
		session: Schema.String,
		url: Schema.String,
		docs: Schema.Array(
			Schema.Struct({
				kb: Schema.Number,
				title: Schema.String,
				path: Schema.String,
			}),
		),
	}),
)
let configurationPath = process.argv[2]
let outputPath = process.argv[3]
if (!configurationPath || !outputPath)
	throw Error(
		"Usage: bun experiments/performance/switch.ts REWRITE_CONFIG.json RESULTS.json",
	)
let configs = Schema.decodeUnknownSync(Configuration)(
	await Bun.file(configurationPath).json(),
)
let configuration = configs[0]
if (!configuration) throw Error("Missing configuration")
let session = configuration.session
let results = []
for (let kb of [32, 128]) {
	let target = configuration.docs.find(doc => doc.kb === kb)
	let small = configuration.docs.find(doc => doc.kb === 2)
	if (!target || !small) throw Error("Missing fixtures")
	let values = []
	browser(session, "open", configuration.url + small.path)
	for (let iteration = 0; iteration < 9; iteration++) {
		if (iteration)
			browser(session, "click", `[data-doc="${small.path.split("/").at(-1)}"]`)
		browser(
			session,
			"wait",
			"--fn",
			`document.querySelector('alkalye-editor')?.source.value.includes(${JSON.stringify(small.title)})`,
		)
		if (
			evaluate(
				session,
				"!document.querySelector('#app').classList.contains('library-open')",
			)
		)
			browser(session, "click", '[data-action="library"]')
		evaluate(
			session,
			`window.__benchmark.armJourney('switch',()=>document.querySelector('alkalye-editor')?.source.value.includes(${JSON.stringify(target.title)}));true`,
		)
		browser(session, "click", `[data-doc="${target.path.split("/").at(-1)}"]`)
		browser(session, "wait", "--fn", "window.__benchmark.arm===null")
		values.push(
			Schema.decodeUnknownSync(Schema.Number)(
				evaluate(session, "window.__benchmark.samples.at(-1).ms"),
			),
		)
	}
	let sorted = [...values].sort((left, right) => left - right)
	results.push({
		name: "switch existing document",
		version: "rewrite",
		kb,
		values,
		medianMs: sorted[4],
		minMs: sorted[0],
		maxMs: sorted.at(-1),
	})
	console.log(JSON.stringify(results.at(-1)))
}
await Bun.write(outputPath, JSON.stringify({ results }, null, 2))
