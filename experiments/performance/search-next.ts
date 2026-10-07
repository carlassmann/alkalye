import * as Schema from "effect/Schema"
import { browser, evaluate } from "../../tests/browser-driver"

let Configuration = Schema.Array(
	Schema.Struct({
		name: Schema.String,
		session: Schema.String,
		url: Schema.String,
	}),
)
let configurationPath = Bun.argv[2],
	outputPath = Bun.argv[3]
if (!configurationPath || !outputPath)
	throw Error("Configuration and output required")
let configurations = Schema.decodeUnknownSync(Configuration)(
	await Bun.file(configurationPath).json(),
)
let source =
	"# Search density\n\n" +
	"Here we see severe repeated letters everywhere. We meet keen readers.\n".repeat(
		500,
	)
let results = [],
	failures = []
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
		`(()=>{let source=document.querySelector('alkalye-editor').source;source.value=${JSON.stringify(source)};source.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
	)
	browser(
		configuration.session,
		"wait",
		"--fn",
		"document.querySelector('#save-status')?.dataset.pending==='0' && document.querySelector('#save-status')?.getAttribute('aria-busy')==='false'",
	)
	browser(configuration.session, "press", "Control+f")
	browser(configuration.session, "fill", "#find-text", "e")
	browser(
		configuration.session,
		"wait",
		"--fn",
		"CSS.highlights?.get('alkalye-search')?.size>20",
	)
}
for (let trial = 0; trial < 5; trial++) {
	for (let configuration of trial % 2
		? configurations.slice().reverse()
		: configurations) {
		let session = configuration.session
		try {
			evaluate(
				session,
				"(()=>{let source=document.querySelector('alkalye-editor').source;source.setSelectionRange(source.value.length,source.value.length);source.viewport.scrollTop=600;return true})()",
			)
			browser(
				session,
				"wait",
				"--fn",
				"document.querySelector('alkalye-editor').source.viewport.scrollTop>=600 && CSS.highlights?.get('alkalye-search')?.size>20",
			)
			let coverage = evaluate(
				session,
				`(()=>{let editor=document.querySelector('alkalye-editor'),bounds=editor.getBoundingClientRect(),ranges=[...CSS.highlights.get('alkalye-search')];return {scrollTop:editor.source.viewport.scrollTop,nativeRanges:ranges.length,visibleRanges:ranges.filter(range=>[...range.getClientRects()].some(rect=>rect.height>0&&rect.bottom>bounds.top&&rect.top<bounds.bottom)).length}})()`,
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
				"(()=>{let state=window.__nextTrial={start:0,end:0},seen=false;document.addEventListener('keydown',event=>{if(event.isTrusted){state.start=performance.now();performance.mark('next:start')}},{once:true,capture:true});function check(){if(state.start&&document.querySelector('alkalye-editor').source.selectionStart===3&&document.querySelectorAll('.search-match[data-active]').length===1){if(seen){state.end=performance.now();performance.mark('next:end');return}seen=true}requestAnimationFrame(check)}requestAnimationFrame(check);return true})()",
			)
			browser(session, "focus", "#find-next")
			browser(session, "press", "Enter")
			browser(session, "wait", "--fn", "window.__nextTrial.end>0")
			let tracePath =
				outputPath.replace(/\.json$/, "") +
				`-${configuration.name}-${trial}.trace.json`
			browser(session, "profiler", "stop", tracePath)
			let correctness = evaluate(
				session,
				`(()=>{let editor=document.querySelector('alkalye-editor');return {sourceExact:editor.source.value===${JSON.stringify(source)},selectionStart:editor.source.selectionStart,selectionEnd:editor.source.selectionEnd,scrollTop:editor.source.viewport.scrollTop,searchFocus:document.activeElement.id==='find-text',nativeLength:document.querySelector('#editor').value.length,paintOpportunityMs:window.__nextTrial.end-window.__nextTrial.start}})()`,
			)
			results.push({
				name: configuration.name,
				trial,
				coverage,
				correctness,
				tracePath,
			})
		} catch (error) {
			failures.push({ name: configuration.name, trial, error: String(error) })
		}
		await Bun.write(
			outputPath,
			JSON.stringify(
				{ sourceCharacters: source.length, results, failures },
				null,
				2,
			),
		)
	}
}
