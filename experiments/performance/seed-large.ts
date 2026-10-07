import * as Schema from "effect/Schema"
import { browser, evaluate } from "../../tests/browser-driver"
import { performanceFixture } from "./fixture"

let Configuration = Schema.Struct({
	kind: Schema.Literals(["original", "rewrite"]),
	session: Schema.String,
	url: Schema.String,
	docs: Schema.Array(
		Schema.Struct({
			kb: Schema.Number,
			title: Schema.String,
			path: Schema.String,
		}),
	),
})
let Outcome = Schema.Struct({
	durable: Schema.Boolean,
	characters: Schema.Number,
	status: Schema.String,
	path: Schema.String,
})
let configurationPath = process.argv[2],
	outputPath = process.argv[3]
if (!configurationPath || !outputPath)
	throw Error(
		"Usage: bun experiments/performance/seed-large.ts CONFIG.json OUTPUT.json",
	)
let configurations = Schema.decodeUnknownSync(Schema.Array(Configuration))(
	await Bun.file(configurationPath).json(),
)
let outcomes = []
for (let configuration of configurations) {
	let session = configuration.session,
		original = configuration.kind === "original",
		source = original
			? "document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString()"
			: "document.querySelector('alkalye-editor')?.source.value"
	try {
		browser(
			session,
			"open",
			configuration.url + (original ? "/app/new" : "/app"),
		)
		browser(session, "wait", "--fn", `${source}!==undefined`)
		if (!original) {
			evaluate(
				session,
				"document.querySelector('[data-action=\"new\"]').click();true",
			)
			browser(session, "wait", "--fn", `${source}===''`)
		}
		let started = performance.now()
		evaluate(
			session,
			`(()=>{window.__largeFixtureExpected=(${performanceFixture.toString()})(1024,'long-line');${
				original
					? "let view=document.querySelector('.cm-content').cmTile.view;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:window.__largeFixtureExpected}});"
					: "let editor=document.querySelector('alkalye-editor').source;editor.value=window.__largeFixtureExpected;editor.dispatchEvent(new Event('input',{bubbles:true}));"
			}return true})()`,
		)
		let saved = original
			? "window.__benchmark.lastSaved?.content===window.__largeFixtureExpected"
			: "document.querySelector('#save-status')?.textContent==='Saved'&&document.querySelector('#save-status')?.dataset.pending==='0'"
		let outcome = Schema.decodeUnknownSync(Outcome)(
			evaluate(
				session,
				`new Promise(resolve=>{let observer=new MutationObserver(check),deadline=setTimeout(()=>finish(false),25000);function finish(durable){clearTimeout(deadline);observer.disconnect();resolve({durable,characters:${source}?.length??0,status:document.querySelector('#save-status')?.textContent??'',path:location.pathname})}function check(){if(${source}===window.__largeFixtureExpected&&(${saved}))finish(true)}observer.observe(document.body,{attributes:true,childList:true,subtree:true,characterData:true});window.addEventListener('alkalye:document-saved',check,{once:true});check()})`,
			),
		)
		let result = {
			version: configuration.kind,
			shape: "long-line",
			setupMs: performance.now() - started,
			...outcome,
		}
		outcomes.push(result)
		console.log(JSON.stringify(result))
		if (outcome.durable) {
			let fixture = { kb: 1024, title: "Benchmark 1024 KB", path: outcome.path }
			configurations = configurations.map(entry =>
				entry === configuration
					? { ...entry, docs: [...entry.docs, fixture] }
					: entry,
			)
		}
	} catch (error) {
		outcomes.push({ version: configuration.kind, error: String(error) })
	}
	await Bun.write(
		outputPath,
		JSON.stringify({ configurations, outcomes }, null, 2),
	)
}
