import * as Schema from "effect/Schema"
import { browser, browserBatch, evaluate } from "../../tests/browser-driver"

let Configuration = Schema.Struct({
	url: Schema.String,
	session: Schema.String,
	fixtures: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			path: Schema.String,
			characters: Schema.Number,
		}),
	),
})
let input = Bun.argv[2],
	output = Bun.argv[3]
if (!input || !output) throw Error("Configuration and output required")
let configuration = Schema.decodeUnknownSync(Configuration)(
	await Bun.file(input).json(),
)
let results = [],
	failures = []
for (let fixture of configuration.fixtures) {
	let session = configuration.session
	browser(session, "open", new URL(fixture.path, configuration.url).href)
	browser(
		session,
		"wait",
		"--fn",
		`document.querySelector('alkalye-editor')?.source.value.length===${fixture.characters} && !document.querySelector('alkalye-editor').source.readOnly`,
	)
	evaluate(
		session,
		"window.__scrollSource=document.querySelector('alkalye-editor').source.value;true",
	)
	for (let trial = 0; trial < 5; trial++) {
		let tracePath =
			output.replace(/\.json$/, "") + `-${fixture.name}-${trial}.trace.json`
		try {
			evaluate(
				session,
				`(()=>{let source=document.querySelector('alkalye-editor').source;source.setSelectionRange(0,0);let viewport=document.querySelector('[data-editor-viewport]');source.viewport.scrollTop=${trial % 3 === 0 ? "0" : trial % 3 === 1 ? "viewport.scrollHeight/2" : "viewport.scrollHeight-viewport.clientHeight-8000"};return true})()`,
			)
			browser(
				session,
				"profiler",
				"start",
				"--categories",
				"devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8",
			)
			evaluate(
				session,
				"(()=>{let state=window.__scrollObservation={start:performance.now(),end:0,frames:[],events:[],wheels:0},previous=0;performance.mark('critical:scroll:start');document.addEventListener('wheel',()=>state.wheels++);document.querySelector('[data-editor-viewport]').addEventListener('scroll',()=>state.events.push(performance.now()));function frame(time){if(previous)state.frames.push(time-previous);previous=time;if(!state.end)requestAnimationFrame(frame)}requestAnimationFrame(frame);return true})()",
			)
			browserBatch(
				session,
				Array.from({ length: 12 }, () => [
					"scroll",
					"down",
					"600",
					"--selector",
					"[data-editor-viewport]",
				]),
			)
			evaluate(
				session,
				"new Promise(resolve=>setTimeout(()=>{window.__scrollObservation.end=performance.now();performance.mark('critical:scroll:end');resolve(true)},3000))",
			)
			browser(session, "profiler", "stop", tracePath)
			let observation = evaluate(
				session,
				"({...window.__scrollObservation,sourceExact:document.querySelector('alkalye-editor').source.value===window.__scrollSource,nativeCharacters:document.querySelector('#editor').value.length,scrollTop:document.querySelector('alkalye-editor').source.viewport.scrollTop})",
			)
			results.push({ fixture: fixture.name, trial, observation, tracePath })
		} catch (error) {
			failures.push({ fixture: fixture.name, trial, error: String(error) })
			break
		}
		await Bun.write(output, JSON.stringify({ results, failures }, null, 2))
	}
}
