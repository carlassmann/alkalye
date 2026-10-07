import * as Schema from "effect/Schema"
import { browser, evaluate } from "../../../tests/browser-driver"

let Fixture = Schema.Struct({
	name: Schema.String,
	characters: Schema.Number,
	occurrences: Schema.Number,
	path: Schema.String,
})
let Configuration = Schema.Struct({
	url: Schema.String,
	session: Schema.String,
	fixtures: Schema.Array(Fixture),
})
let configurationPath = Bun.argv[2],
	outputDirectory = Bun.argv[3]
if (!configurationPath || !outputDirectory)
	throw new Error("Configuration path and output directory required")
let configuration = Schema.decodeUnknownSync(Configuration)(
	await Bun.file(configurationPath).json(),
)
let results = []
let checkpoints = []
let freshEcho = Bun.argv.includes("--fresh-echo")
function assertOriginal(fixture: typeof Fixture.Type) {
	let matches = evaluate(
		configuration.session,
		`(()=>{let source=document.querySelector('alkalye-editor').source.value;return source===('TOKEN '+'z'.repeat(${fixture.characters}/${fixture.occurrences}-7)+'\\n').repeat(${fixture.occurrences})})()`,
	)
	if (!matches)
		throw Error("Original fixture content mismatch: " + fixture.name)
}
function refreshAcceptedSnapshot(fixture: typeof Fixture.Type) {
	let id = fixture.path.split("/").at(-1)
	assertOriginal(fixture)
	evaluate(
		configuration.session,
		`(()=>{window.__cacheSaveReady=false;window.__cacheCursorFloor=-1;window.__cacheStage='edit';window.__cacheMetrics=[];window.__cacheEditStart=0;document.addEventListener('beforeinput',()=>{window.__cacheEditStart=performance.now();performance.mark('accepted-edit:start')},{capture:true});if(!window.__originalCachePut){window.__originalCachePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){let request=window.__originalCachePut.call(this,value,key);if(this.name==='cache'&&key==='projection'&&this.transaction.db.name.endsWith(','+JSON.stringify(${JSON.stringify(id)})+']')){let database=this.transaction.db;this.transaction.addEventListener('complete',()=>{let cursor=database.transaction('positions').objectStore('positions').openKeyCursor(null,'prev');cursor.onsuccess=()=>{if(cursor.result?.key===value.position&&value.position>window.__cacheCursorFloor&&value.value.pending.length===0&&(value.value.rejected?.length??0)===0){window.__cacheSaveReady=true;window.__cacheMetrics.push({stage:window.__cacheStage,delayMilliseconds:performance.now()-window.__cacheEditStart,position:value.position,pending:value.value.pending.length,rejected:value.value.rejected?.length??0,heap:performance.memory?.usedJSHeapSize});performance.mark('accepted-edit:cache')}}})}return request}}let source=document.querySelector('alkalye-editor').source;source.setSelectionRange(source.value.length,source.value.length);document.querySelector('#editor').focus();return true})()`,
	)
	browser(configuration.session, "keyboard", "inserttext", "X")
	browser(
		configuration.session,
		"wait",
		"--fn",
		`document.querySelector('alkalye-editor').source.value.length===${fixture.characters + 1} && document.querySelector('#save-status')?.dataset.pending==='0' && document.querySelector('#save-status')?.getAttribute('aria-busy')==='false' && window.__cacheSaveReady`,
	)
	evaluate(
		configuration.session,
		"window.__cacheCursorFloor=window.__cacheMetrics.at(-1).position;window.__cacheSaveReady=false;window.__cacheStage='undo';window.__cacheEditStart=performance.now();performance.mark('accepted-undo:start');true",
	)
	browser(configuration.session, "press", "Control+z")
	browser(
		configuration.session,
		"wait",
		"--fn",
		`(${ready(fixture)}) && window.__cacheSaveReady && document.querySelector('#save-status')?.dataset.pending==='0'`,
	)
	assertOriginal(fixture)
	evaluate(
		configuration.session,
		"IDBObjectStore.prototype.put=window.__originalCachePut;delete window.__originalCachePut;true",
	)
}

function ready(fixture: typeof Fixture.Type) {
	return `location.pathname===${JSON.stringify(fixture.path)} && document.querySelector('alkalye-editor')?.source.value.length===${fixture.characters} && (document.querySelector('alkalye-editor').source.value.match(/\\n/g)||[]).length===${fixture.occurrences}`
}
function select(fixture: typeof Fixture.Type) {
	let id = fixture.path.split("/").at(-1)
	browser(configuration.session, "click", `[data-doc="${id}"]`)
	browser(configuration.session, "wait", "--fn", ready(fixture))
}
for (let name of ["128k-512", "1m-512"]) {
	let fixture = configuration.fixtures.find(item => item.name === name),
		base = configuration.fixtures.find(item => item.name === "128k-2048")
	if (!fixture || !base) throw new Error("Missing cached-open fixtures")
	select(fixture)
	if (freshEcho) {
		browser(
			configuration.session,
			"profiler",
			"start",
			"--categories",
			"devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8",
		)
		refreshAcceptedSnapshot(fixture)
		checkpoints.push({
			name,
			metrics: evaluate(configuration.session, "window.__cacheMetrics"),
			tracePath: `${outputDirectory}/${name}-checkpoint.trace.json`,
		})
		browser(
			configuration.session,
			"profiler",
			"stop",
			`${outputDirectory}/${name}-checkpoint.trace.json`,
		)
	}
	select(base)
	if (
		!evaluate(
			configuration.session,
			"document.querySelector('#app')?.classList.contains('library-open')",
		)
	)
		browser(configuration.session, "click", '[data-action="library"]')
	browser(
		configuration.session,
		"profiler",
		"start",
		"--categories",
		"devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8",
	)
	evaluate(
		configuration.session,
		`(()=>{window.__openSample={started:0,ready:0,first:0,second:0};document.addEventListener('click',()=>{window.__openSample.started=performance.now();performance.mark('cached-open:start')},{once:true,capture:true});function check(){let state=window.__openSample;if(state.started&&(${ready(fixture)})){state.ready=performance.now();performance.mark('cached-open:ready');requestAnimationFrame(()=>{state.first=performance.now();requestAnimationFrame(()=>{state.second=performance.now();performance.mark('cached-open:end')})});return}requestAnimationFrame(check)}requestAnimationFrame(check);return true})()`,
	)
	select(fixture)
	browser(configuration.session, "wait", "--fn", "window.__openSample.second>0")
	let path = `${outputDirectory}/${name}.trace.json`
	browser(configuration.session, "profiler", "stop", path)
	results.push({
		name,
		characters: fixture.characters,
		tracePath: path,
		metrics: evaluate(
			configuration.session,
			"(()=>{let state=window.__openSample;return {heap:performance.memory?.usedJSHeapSize,readyMilliseconds:state.ready-state.started,firstFrameOpportunityMilliseconds:state.first-state.started,secondFrameOpportunityMilliseconds:state.second-state.started}})()",
		),
	})
}
await Bun.write(
	`${outputDirectory}/cached-browser-open-results.json`,
	JSON.stringify(
		{ configurationPath, freshEcho, results, checkpoints },
		null,
		2,
	) + "\n",
)
console.log(JSON.stringify(results))
