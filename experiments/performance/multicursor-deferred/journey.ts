import * as Schema from "effect/Schema"
import { browser, evaluate } from "../../../tests/browser-driver"

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
let Sample = Schema.Struct({
	ms: Schema.optional(Schema.Number),
	error: Schema.optional(Schema.String),
})
let configurationPath = process.argv[2],
	outputPath = process.argv[3]
if (!configurationPath || !outputPath)
	throw Error(
		"Usage: bun experiments/performance/multicursor.ts CONFIG.json OUTPUT.json",
	)
let configurations = Schema.decodeUnknownSync(Schema.Array(Configuration))(
	await Bun.file(configurationPath).json(),
)
let results = [],
	failures = []
for (let configuration of configurations) {
	let fixture = configuration.docs.find(document => document.kb === 128)
	if (!fixture) continue
	let original = configuration.kind === "original",
		session = configuration.session
	let source = original
		? "document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString()"
		: "document.querySelector('alkalye-editor')?.source.value"
	try {
		browser(
			session,
			"--profile",
			Bun.env.BENCHMARK_PROFILE ?? "",
			"open",
			configuration.url + fixture.path,
		)
		browser(
			session,
			"wait",
			"--fn",
			`${source}?.includes(${JSON.stringify(fixture.title)})`,
		)
		browser(
			session,
			"wait",
			"--fn",
			"document.querySelector('#save-status')?.dataset.pending==='0'",
		)
		let id = fixture.path.split("/").at(-1)
		evaluate(
			session,
			`(()=>{window.__cacheStage='initial';window.__cacheFloor=-1;window.__cacheReady=false;window.__cacheMetrics=[];let put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){let stage=window.__cacheStage,request=put.call(this,value,key);if(this.name==='cache'&&key==='projection'&&this.transaction.db.name.endsWith(','+JSON.stringify(${JSON.stringify(id)})+']')){let database=this.transaction.db;this.transaction.addEventListener('complete',()=>{let cursor=database.transaction('positions').objectStore('positions').openKeyCursor(null,'prev');cursor.onsuccess=()=>{let metric={stage,position:value.position,pending:value.value.pending.length,rejected:value.value.rejected?.length??0,latest:cursor.result?.key,at:performance.now()};window.__cacheMetrics.push(metric);if(stage===window.__cacheStage&&metric.latest===metric.position&&metric.position>window.__cacheFloor&&metric.pending===0&&metric.rejected===0)window.__cacheReady=true}})}return request};return true})()`,
		)

		evaluate(
			session,
			`new Promise(async resolve=>{let databases=await indexedDB.databases(),record=databases.find(value=>value.name?.endsWith(','+JSON.stringify(${JSON.stringify(id)})+']'));if(!record){resolve(false);return}let open=indexedDB.open(record.name);open.onsuccess=()=>{let db=open.result,tx=db.transaction(['cache','positions']),cache=tx.objectStore('cache').get('projection'),cursor=tx.objectStore('positions').openKeyCursor(null,'prev'),value,head;cache.onsuccess=()=>value=cache.result;cursor.onsuccess=()=>head=cursor.result?.key;tx.oncomplete=()=>{window.__cacheReady=!!value&&value.position===head&&value.value.pending.length===0&&(value.value.rejected?.length??0)===0;db.close();resolve(true)}}})`,
		)
		browser(session, "wait", "--fn", "window.__cacheReady")
		let after = []
		let values = [],
			cursors = []
		for (let iteration = 0; iteration < 3; iteration++) {
			evaluate(
				session,
				"window.__cacheStage='replace';window.__cacheFloor=window.__cacheMetrics.at(-1)?.position??-1;window.__cacheReady=false;true",
			)
			let count = Schema.decodeUnknownSync(Schema.Number)(
				evaluate(
					session,
					`(()=>{let text=${source};window.__multiOriginal=text;window.__multiPrior=(text.match(/MULTIX/g)||[]).length;return (text.match(/responsiveness/g)||[]).length})()`,
				),
			)
			if (original)
				evaluate(
					session,
					"(()=>{let view=document.querySelector('.cm-content').cmTile.view,ranges=[];for(let match of view.state.doc.toString().matchAll(/responsiveness/g))ranges.push(view.state.selection.constructor.range(match.index,match.index+14));view.dispatch({selection:view.state.selection.constructor.create(ranges)});view.focus();return true})()",
				)
			else {
				evaluate(
					session,
					"(()=>{let editor=document.querySelector('alkalye-editor').source,index=editor.value.indexOf('responsiveness');editor.setSelectionRange(index,index+14);editor.focus();return true})()",
				)
				browser(session, "press", "Control+Shift+l")
			}
			evaluate(
				session,
				`window.__benchmark.armJourney('multicursor replace',()=>(${source}.match(/responsiveness/g)||[]).length===0&&(${source}.match(/MULTIX/g)||[]).length===window.__multiPrior+${count});true`,
			)
			let trace =
				outputPath.replace(/\.json$/, "") +
				`-${configuration.kind}-${iteration}.trace.json`
			browser(
				session,
				"profiler",
				"start",
				"--categories",
				"devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8",
			)
			evaluate(
				session,
				"document.addEventListener('beforeinput',event=>{if(event.isTrusted)performance.mark('matrix:multicursor:start')},{once:true,capture:true});true",
			)
			browser(session, "keyboard", "inserttext", "MULTIX")
			browser(session, "wait", "--fn", "window.__benchmark.arm===null")
			let sample = Schema.decodeUnknownSync(Sample)(
				evaluate(session, "window.__benchmark.samples.at(-1)"),
			)
			if (sample.error || sample.ms === undefined)
				throw Error(sample.error ?? "Missing multicursor timing")
			console.log(
				JSON.stringify({ stage: "replacement", iteration, ms: sample.ms }),
			)
			values.push(sample.ms)
			cursors.push(count)
			evaluate(
				session,
				"new Promise(resolve=>setTimeout(()=>{performance.mark('matrix:multicursor:end');resolve(true)},3000))",
			)
			browser(session, "profiler", "stop", trace)
			after.push(
				evaluate(
					session,
					"({cacheReady:window.__cacheReady,metrics:window.__cacheMetrics,sourceExact:document.querySelector('alkalye-editor').source.value===window.__multiOriginal.replaceAll('responsiveness','MULTIX'),pending:document.querySelector('#save-status').dataset.pending,busy:document.querySelector('#save-status').getAttribute('aria-busy')})",
				),
			)
			evaluate(
				session,
				"window.__cacheFloor=window.__cacheMetrics.at(-1)?.position??-1;window.__cacheReady=false;window.__cacheStage='restore';true",
			)
			evaluate(
				session,
				original
					? "(()=>{let view=document.querySelector('.cm-content').cmTile.view;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:window.__multiOriginal}});return true})()"
					: "(()=>{let editor=document.querySelector('alkalye-editor').source;editor.value=window.__multiOriginal;editor.dispatchEvent(new Event('input',{bubbles:true}));return true})()",
			)
			browser(
				session,
				"wait",
				"--fn",
				original
					? "window.__benchmark.lastSaved?.content===window.__multiOriginal"
					: "document.querySelector('alkalye-editor').source.value===window.__multiOriginal&&document.querySelector('#save-status')?.dataset.pending==='0'",
			)
			if (Bun.env.BENCHMARK_RESTORE_GATE === "clean")
				browser(
					session,
					"wait",
					"--fn",
					"window.__cacheReady&&document.querySelector('alkalye-editor').source.value===window.__multiOriginal&&document.querySelector('#save-status').dataset.pending==='0'",
				)
		}
		console.log(
			JSON.stringify({
				stage: "complete",
				mode: Bun.env.BENCHMARK_RESTORE_GATE,
			}),
		)
		let sorted = values.slice().sort((left, right) => left - right)
		results.push({
			version: configuration.kind,
			name: "replace all occurrences",
			kb: 128,
			n: values.length,
			values,
			cursors,
			after,
			medianMs: sorted[1],
			p95Ms: sorted[2],
			selectionSetup: original
				? "CodeMirror public EditorSelection API"
				: "Select all occurrences shortcut",
			restoration:
				"Complete original source through public editor boundary; excluded from replacement timing",
		})
	} catch (error) {
		failures.push({ version: configuration.kind, error: String(error) })
	}
	await Bun.write(outputPath, JSON.stringify({ results, failures }, null, 2))
}
