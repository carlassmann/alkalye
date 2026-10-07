import * as Schema from "effect/Schema"
import { browser, evaluate } from "../../../tests/browser-driver"
let Configuration = Schema.Struct({
	url: Schema.String,
	session: Schema.String,
	path: Schema.String,
	characters: Schema.Number,
	occurrences: Schema.Number,
})
let path = Bun.argv[2],
	output = Bun.argv[3]
if (!path || !output) throw Error("Configuration and output required")
let configuration = Schema.decodeUnknownSync(Configuration)(
	await Bun.file(path).json(),
)
let session = configuration.session,
	id = configuration.path.split("/").at(-1)
browser(session, "open", new URL(configuration.path, configuration.url).href)
browser(
	session,
	"wait",
	"--fn",
	`document.querySelector('alkalye-editor')?.source.value.length===${configuration.characters} && !document.querySelector('alkalye-editor').source.readOnly`,
)
evaluate(
	session,
	`(()=>{let original=('TOKEN '+'z'.repeat(${configuration.characters / configuration.occurrences - 7})+'\\n').repeat(${configuration.occurrences});let source=document.querySelector('alkalye-editor').source;if(source.value!==original)throw Error('Fixture mismatch');window.__undoOriginal=original;window.__undoMetrics=[];window.__undoCursorFloor=-1;window.__undoReady=false;window.__undoStage='edit';window.__undoStarted=0;let put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){let stage=window.__undoStage,request=put.call(this,value,key);if(this.name==='cache'&&key==='projection'&&this.transaction.db.name.endsWith(','+JSON.stringify(${JSON.stringify(id)})+']')){let database=this.transaction.db;this.transaction.addEventListener('complete',()=>{let cursor=database.transaction('positions').objectStore('positions').openKeyCursor(null,'prev');cursor.onsuccess=()=>{if(stage===window.__undoStage&&cursor.result?.key===value.position&&value.position>window.__undoCursorFloor&&value.value.pending.length===0&&(value.value.rejected?.length??0)===0){window.__undoReady=true;window.__undoMetrics.push({stage,delay:performance.now()-window.__undoStarted,position:value.position,pending:value.value.pending.length,rejected:value.value.rejected?.length??0});performance.mark(stage+':cache')}}})}return request};document.addEventListener('beforeinput',event=>{if(event.isTrusted&&window.__undoStage==='edit'){window.__undoStarted=performance.now();performance.mark('edit:start')}},{capture:true});document.addEventListener('keydown',event=>{if(event.isTrusted&&window.__undoStage==='undo'&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){window.__undoStarted=performance.now();performance.mark('undo:start');window.__undoTrusted=true}},{capture:true});source.setSelectionRange(source.value.length,source.value.length);source.focus();return true})()`,
)
browser(
	session,
	"profiler",
	"start",
	"--categories",
	"devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8",
)
let failure: string | undefined
try {
	browser(session, "keyboard", "inserttext", "X")
	browser(
		session,
		"wait",
		"--fn",
		"document.querySelector('alkalye-editor').source.value===window.__undoOriginal+'X' && window.__undoReady && document.querySelector('#save-status')?.dataset.pending==='0' && document.querySelector('#save-status')?.getAttribute('aria-busy')==='false'",
	)
	evaluate(
		session,
		"window.__undoCursorFloor=window.__undoMetrics.at(-1).position;window.__undoReady=false;window.__undoStage='undo';window.__undoPaint=0;window.__undoTrusted=false;requestAnimationFrame(function check(){if(window.__undoStarted&&window.__undoTrusted&&document.querySelector('alkalye-editor').source.value===window.__undoOriginal){requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__undoPaint=performance.now();performance.mark('undo:paint-opportunity')}));return}requestAnimationFrame(check)});true",
	)
	browser(session, "press", "Control+z")
	browser(
		session,
		"wait",
		"--fn",
		"document.querySelector('alkalye-editor').source.value===window.__undoOriginal && window.__undoPaint>0 && window.__undoReady && document.querySelector('#save-status')?.dataset.pending==='0' && document.querySelector('#save-status')?.getAttribute('aria-busy')==='false'",
	)
} catch (error) {
	failure = error instanceof Error ? error.message : String(error)
}
browser(session, "profiler", "stop", output.replace(/\.json$/, ".trace.json"))
let metrics = evaluate(
	session,
	"({stages:window.__undoMetrics,trusted:window.__undoTrusted,started:window.__undoStarted,paint:window.__undoPaint,exact:document.querySelector('alkalye-editor').source.value===window.__undoOriginal,pending:document.querySelector('#save-status')?.dataset.pending,busy:document.querySelector('#save-status')?.getAttribute('aria-busy'),scripts:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('.js')).map(entry=>({name:entry.name,bytes:entry.decodedBodySize})),controller:navigator.serviceWorker.controller?.scriptURL??''})",
)
await Bun.write(
	output,
	JSON.stringify({ configuration, failure, metrics }, null, 2),
)
if (failure) throw Error(failure)
