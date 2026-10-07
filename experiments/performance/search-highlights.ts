import * as Schema from "effect/Schema"
import { browser, evaluate } from "../../tests/browser-driver"

let Configuration = Schema.Array(
	Schema.Struct({
		mode: Schema.Literals(["native", "fallback"]),
		session: Schema.String,
		url: Schema.String,
	}),
)
let Sample = Schema.Struct({ started: Schema.Number, finished: Schema.Number })
let Correctness = Schema.Struct({
	sourceMatches: Schema.Number,
	nativeRanges: Schema.Number,
	overlayMarks: Schema.Number,
	activeMarks: Schema.Number,
	selection: Schema.Number,
})
let configurationPath = Bun.argv[2],
	outputPath = Bun.argv[3]
if (!configurationPath || !outputPath)
	throw Error(
		"Usage: bun experiments/performance/search-highlights.ts CONFIG.json OUTPUT.json",
	)
let configurations = Schema.decodeUnknownSync(Configuration)(
	await Bun.file(configurationPath).json(),
)
let results = [],
	failures = []
let source =
	"# Search density\n\n" +
	"Here we see severe repeated letters everywhere. We meet keen readers.\n".repeat(
		500,
	)
for (let configuration of configurations) {
	browser(configuration.session, "open", configuration.url + "app")
	browser(
		configuration.session,
		"wait",
		"--fn",
		"document.querySelector('alkalye-editor')?.source && !document.querySelector('alkalye-editor').source.readOnly",
	)
	evaluate(
		configuration.session,
		`(()=>{let editor=document.querySelector('alkalye-editor').source;editor.value=${JSON.stringify(source)};editor.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
	)
	browser(
		configuration.session,
		"wait",
		"--fn",
		"document.querySelector('#save-status')?.dataset.pending==='0' && document.querySelector('#save-status')?.getAttribute('aria-busy')==='false'",
	)
	browser(configuration.session, "press", "Control+f")
	browser(
		configuration.session,
		"wait",
		"--fn",
		"document.querySelector('#find-text')?.checkVisibility()",
	)
}
for (let trial = 0; trial < 5; trial++) {
	for (let configuration of trial % 2
		? configurations.slice().reverse()
		: configurations) {
		let session = configuration.session
		let tracePath =
			outputPath.replace(/\.json$/, "") +
			`-${configuration.mode}-${trial}.trace.json`
		try {
			browser(session, "fill", "#find-text", "")
			evaluate(
				session,
				"document.querySelector('alkalye-editor').source.viewport.scrollTop=0;true",
			)
			browser(
				session,
				"wait",
				"--fn",
				"document.querySelectorAll('.search-match').length===0 && !(CSS.highlights?.get('alkalye-search')?.size)",
			)
			browser(
				session,
				"profiler",
				"start",
				"--categories",
				"devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8",
			)
			let measurements = []
			try {
				arm(
					session,
					"find",
					"beforeinput",
					"(CSS.highlights?.get('alkalye-search')?.size??0)+document.querySelectorAll('.search-match').length>20",
				)
				browser(session, "focus", "#find-text")
				browser(session, "keyboard", "inserttext", "e")
				measurements.push(finish(session, "find"))
				arm(
					session,
					"scroll",
					"",
					"document.querySelector('alkalye-editor').source.viewport.scrollTop>=600",
				)
				evaluate(
					session,
					"window.__abPhase.started=performance.now();performance.mark('ab:scroll:start');document.querySelector('alkalye-editor').source.viewport.scrollTop=600;true",
				)
				measurements.push(finish(session, "scroll"))
				evaluate(
					session,
					"window.__abSelection=document.querySelector('alkalye-editor').source.selectionStart;true",
				)
				arm(
					session,
					"next",
					"keydown",
					"document.querySelector('alkalye-editor').source.selectionStart!==window.__abSelection && document.querySelectorAll('.search-match[data-active]').length===1",
				)
				browser(session, "focus", "#find-next")
				browser(session, "press", "Enter")
				measurements.push(finish(session, "next"))
			} finally {
				browser(session, "profiler", "stop", tracePath)
			}
			let correctness = Schema.decodeUnknownSync(Correctness)(
				evaluate(
					session,
					"({sourceMatches:(document.querySelector('alkalye-editor').source.value.match(/e/g)||[]).length,nativeRanges:CSS.highlights?.get('alkalye-search')?.size??0,overlayMarks:document.querySelectorAll('.search-match').length,activeMarks:document.querySelectorAll('.search-match[data-active]').length,selection:document.querySelector('alkalye-editor').source.selectionStart})",
				),
			)
			if (
				correctness.activeMarks !== 1 ||
				(configuration.mode === "native"
					? correctness.nativeRanges < 20
					: correctness.nativeRanges !== 0 || correctness.overlayMarks < 20)
			)
				throw Error("Highlight correctness failed")
			results.push({
				mode: configuration.mode,
				trial,
				measurements,
				correctness,
				tracePath,
			})
		} catch (error) {
			failures.push({ mode: configuration.mode, trial, error: String(error) })
		}
		await Bun.write(
			outputPath,
			JSON.stringify(
				{
					sourceCharacters: source.length,
					trialsPerMode: 5,
					results,
					failures,
				},
				null,
				2,
			),
		)
	}
}
function arm(session: string, name: string, event: string, condition: string) {
	evaluate(
		session,
		`(()=>{let phase=window.__abPhase={started:0,finished:0},seen=false;${event ? `document.addEventListener(${JSON.stringify(event)},event=>{if(event.isTrusted){phase.started=performance.now();performance.mark('ab:${name}:start')}},{once:true,capture:true});` : ""}function check(){if(phase.started&&(${condition})){if(seen){phase.finished=performance.now();performance.mark('ab:${name}:end');return}seen=true}requestAnimationFrame(check)}requestAnimationFrame(check);return true})()`,
	)
}
function finish(session: string, name: string) {
	browser(session, "wait", "--fn", "window.__abPhase.finished>0")
	let sample = Schema.decodeUnknownSync(Sample)(
		evaluate(session, "window.__abPhase"),
	)
	return { name, milliseconds: sample.finished - sample.started }
}
