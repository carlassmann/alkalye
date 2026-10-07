import * as Schema from "effect/Schema"
import { browser, browserBatch, evaluate } from "../../tests/browser-driver"

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
let Observation = Schema.Struct({
	started: Schema.Number,
	finished: Schema.Number,
	sourceCharacters: Schema.Number,
	durableObserved: Schema.Boolean,
	sent: Schema.Array(
		Schema.Struct({
			count: Schema.Number,
			time: Schema.Number,
			taskMs: Schema.Number,
		}),
	),
	frames: Schema.Array(Schema.Number),
	badge: Schema.Struct({
		text: Schema.String,
		pending: Schema.String,
		busy: Schema.String,
		phase: Schema.String,
		version: Schema.String,
	}),
})
let configurationPath = process.argv[2],
	outputPath = process.argv[3]
if (!configurationPath || !outputPath)
	throw Error(
		"Usage: bun experiments/performance/continuous-native.ts CONFIG.json OUTPUT.json",
	)
let configurations = Schema.decodeUnknownSync(Schema.Array(Configuration))(
	await Bun.file(configurationPath).json(),
)
let results = []
for (let configuration of configurations) {
	let fixture = configuration.docs.find(document => document.kb === 128)
	if (!fixture) continue
	let session = configuration.session
	let original = configuration.kind === "original"
	let source = original
		? "document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString()"
		: "document.querySelector('alkalye-editor')?.source.value"
	let marker = ` NATIVE_CONTINUOUS_${Date.now()}_`
	let tracePath =
		outputPath.replace(/\.json$/, "") + `-${configuration.kind}.trace.json`
	browser(session, "open", configuration.url + fixture.path)
	browser(
		session,
		"wait",
		"--fn",
		`${source}?.includes(${JSON.stringify(fixture.title)})`,
	)
	browser(
		session,
		"profiler",
		"start",
		"--categories",
		Bun.env.BENCHMARK_CPU_PROFILE === "1"
			? "devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8,disabled-by-default-v8.cpu_profiler"
			: "devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8",
	)
	try {
		if (Bun.env.BENCHMARK_CPU_PROFILE === "1")
			evaluate(
				session,
				"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))",
			)
		evaluate(
			session,
			`(()=>{
let observation=window.__continuous={started:0,finished:0,sourceCharacters:0,durableObserved:false,sent:[],frames:[],badge:{text:"",pending:"",busy:"",phase:"",version:""}};
let previous=0,nativeStart=0;
function frame(time){if(previous)observation.frames.push(time-previous);previous=time;if(!observation.finished)requestAnimationFrame(frame)}
requestAnimationFrame(frame);
function before(event){if(!event.isTrusted)return;nativeStart=performance.now();if(!observation.started){observation.started=nativeStart;performance.mark('benchmark:continuous:start')}}
function input(event){if(!event.isTrusted)return;let now=performance.now();observation.sent.push({count:observation.sent.length+1,time:nativeStart,taskMs:now-nativeStart});if(observation.sent.length===25){document.removeEventListener('beforeinput',before,true);document.removeEventListener('input',input);setTimeout(()=>{let badge=document.querySelector('#save-status');observation.badge={text:badge?.textContent??'',pending:badge?.dataset.pending??'',busy:badge?.getAttribute('aria-busy')??'',phase:badge?.dataset.phase??'',version:badge?.dataset.version??''};observation.sourceCharacters=${source}?.length??0;observation.durableObserved=${original ? "window.__benchmark.lastSaved?.content?.includes(" + JSON.stringify(marker) + ")??false" : "['Saved','Saved on this device'].includes(badge?.textContent??'')&&badge?.dataset.pending==='0'&&badge?.getAttribute('aria-busy')==='false'"};observation.finished=performance.now();performance.mark('benchmark:continuous:end')},3000)}}
document.addEventListener('beforeinput',before,true);document.addEventListener('input',input);
${original ? "let view=document.querySelector('.cm-content').cmTile.view;view.dispatch({selection:{anchor:view.state.doc.length}});view.focus();" : "let editor=document.querySelector('alkalye-editor').source;editor.setSelectionRange(editor.value.length,editor.value.length);editor.focus();"}
return true})()`,
		)
		browserBatch(
			session,
			Array.from({ length: 25 }, () => ["keyboard", "inserttext", marker]),
		)
		browser(session, "wait", "--fn", "window.__continuous.finished>0")
		let observation = Schema.decodeUnknownSync(Observation)(
			evaluate(session, "window.__continuous"),
		)
		results.push({
			version: configuration.kind,
			kb: fixture.kb,
			trustedInput: true,
			backgroundObservationMs: 3000,
			requestedEdits: 25,
			completedEdits: observation.sent.length,
			intervalMs: null,
			tracePath,
			...observation,
		})
	} finally {
		browser(session, "profiler", "stop", tracePath)
	}
	await Bun.write(outputPath, JSON.stringify({ results }, null, 2))
}
