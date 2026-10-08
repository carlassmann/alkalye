import * as Schema from "effect/Schema"
import { browser, evaluate } from "../../../tests/browser-driver"

let Fixture = Schema.Struct({
	name: Schema.String,
	path: Schema.String,
	characters: Schema.Number,
	occurrences: Schema.Number,
})
let Configuration = Schema.Struct({
	url: Schema.String,
	session: Schema.String,
	fixtures: Schema.Array(Fixture),
})
let configurationPath = Bun.argv[2],
	outputPath = Bun.argv[3]
if (!configurationPath || !outputPath)
	throw Error("Configuration and output required")
let configuration = Schema.decodeUnknownSync(Configuration)(
	await Bun.file(configurationPath).json(),
)
let session = configuration.session,
	results = [],
	failures = []
let selectionState = `(()=>{let source=document.querySelector("alkalye-editor")?.source, native=document.querySelector("#editor"),selection=getSelection();return {sourceStart:source?.selectionStart,sourceEnd:source?.selectionEnd,selected:source?.value.slice(source.selectionStart,source.selectionEnd),nativeStart:native?.selectionStart,nativeEnd:native?.selectionEnd,active:document.activeElement?.id,windowSelection:selection?.toString(),keys:window.__critical?.keys??[],trigger:window.__critical?.key??null}})()`
for (let fixture of configuration.fixtures) {
	let single = fixture.name.includes("single")
	browser(session, "open", new URL(fixture.path, configuration.url).href)
	browser(
		session,
		"wait",
		"--fn",
		`document.querySelector('alkalye-editor')?.source.value.length===${fixture.characters} && !document.querySelector('alkalye-editor').source.readOnly`,
	)
	evaluate(
		session,
		"(()=>{let source=document.querySelector('alkalye-editor').source;window.__criticalSource=source.value;let original=source.replace;source.replace=function(...args){if(args[3])window.__observedEditCount=args[3].length;return original.apply(this,args)};return true})()",
	)
	evaluate(
		session,
		"(()=>{window.__fenceDocument=DOC;window.__fenceAccepted=0;window.__fenceFloor=0;window.__fencePhase='idle';let put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){let phase=window.__fencePhase,request=put.call(this,value,key);if(this.name==='cache'&&key==='projection'&&this.transaction.db.name.endsWith(','+JSON.stringify(DOC)+']')){let database=this.transaction.db;this.transaction.addEventListener('complete',()=>{let cursor=database.transaction('positions').objectStore('positions').openKeyCursor(null,'prev');cursor.onsuccess=()=>{if(window.__fenceDocument===DOC&&phase===window.__fencePhase&&cursor.result?.key===value.position&&value.position>window.__fenceFloor&&value.value.pending.length===0&&(value.value.rejected?.length??0)===0)window.__fenceAccepted=value.position}})}return request};return true})()".replaceAll(
			"DOC",
			JSON.stringify(fixture.path.split("/").at(-1)),
		),
	)
	let provenance = evaluate(
		session,
		"({controller:navigator.serviceWorker.controller?.scriptURL??'',scripts:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('.js')).map(entry=>entry.name),sourceCharacters:window.__criticalSource.length})",
	)
	for (let trial = 0; trial < Number(Bun.env.CRITICAL_TRIALS ?? 5); trial++) {
		let tracePath =
			outputPath.replace(/\.json$/, "") + `-${fixture.name}-${trial}.trace.json`
		try {
			evaluate(
				session,
				"(()=>{let source=document.querySelector('alkalye-editor').source,index=source.value.indexOf('TOKEN');source.setSelectionRange(index,index+5);source.focus();return true})()",
			)
			browser(
				session,
				"wait",
				"--fn",
				"document.activeElement?.id==='editor' && document.querySelector('alkalye-editor').source.value.slice(document.querySelector('alkalye-editor').source.selectionStart,document.querySelector('alkalye-editor').source.selectionEnd)==='TOKEN'",
			)
			browser(
				session,
				"profiler",
				"start",
				"--categories",
				Bun.env.CRITICAL_CPU_PROFILE === "1"
					? "devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8,disabled-by-default-v8.cpu_profiler"
					: "devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8",
			)
			if (Bun.env.CRITICAL_CPU_PROFILE === "1")
				evaluate(
					session,
					"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))",
				)
			let phases = []
			try {
				if (!single) {
					arm(
						session,
						"selection",
						"keydown",
						"document.querySelector('alkalye-editor').source.selectionEnd-document.querySelector('alkalye-editor').source.selectionStart===5",
						false,
					)
					browser(session, "press", "Control+Shift+l")
					phases.push(finish(session, "selection"))
				}
				evaluate(
					session,
					"new Promise(async resolve=>{let names=await indexedDB.databases(),name=names.find(entry=>entry.name?.endsWith(','+JSON.stringify(window.__fenceDocument)+']'))?.name;if(!name)throw Error('Missing journal');let request=indexedDB.open(name);request.onsuccess=()=>{let db=request.result,cursor=db.transaction('positions').objectStore('positions').openKeyCursor(null,'prev');cursor.onsuccess=()=>{window.__fenceFloor=cursor.result?.key??0;window.__fenceAccepted=window.__fenceFloor;window.__fencePhase='edit';db.close();resolve(true)}}})",
				)
				arm(
					session,
					"replacement",
					"beforeinput",
					`(document.querySelector('alkalye-editor').source.value.match(/TOKEN/g)||[]).length===${single ? fixture.occurrences - 1 : 0}`,
					true,
				)
				browser(session, "keyboard", "inserttext", "X")
				phases.push(finish(session, "replacement"))
			} finally {
				browser(session, "profiler", "stop", tracePath)
			}
			let correctness = evaluate(
				session,
				`(()=>{let source=document.querySelector('alkalye-editor').source,badge=document.querySelector('#save-status');return {exact:source.value===window.__criticalSource.${single ? "replace" : "replaceAll"}('TOKEN','X'),remaining:(source.value.match(/TOKEN/g)||[]).length,replacements:(source.value.match(/X/g)||[]).length,observedEditCount:window.__observedEditCount,pending:badge.dataset.pending,busy:badge.getAttribute('aria-busy'),characters:source.value.length}})()`,
			)
			Schema.decodeUnknownSync(Schema.Struct({ exact: Schema.Literal(true) }))(
				correctness,
			)
			browser(
				session,
				"wait",
				"--fn",
				"window.__fenceAccepted>window.__fenceFloor && document.querySelector('#save-status')?.dataset.pending==='0' && document.querySelector('#save-status')?.getAttribute('aria-busy')==='false'",
			)
			let editCursor = evaluate(session, "window.__fenceAccepted")
			evaluate(
				session,
				"window.__fenceFloor=window.__fenceAccepted;window.__fencePhase='undo';true",
			)
			browser(session, "press", "Control+z")
			browser(
				session,
				"wait",
				"--fn",
				"document.querySelector('alkalye-editor').source.value===window.__criticalSource && window.__fenceAccepted>window.__fenceFloor && document.querySelector('#save-status')?.dataset.pending==='0' && document.querySelector('#save-status')?.getAttribute('aria-busy')==='false'",
			)
			results.push({
				fixture: fixture.name,
				trial,
				provenance,
				phases,
				correctness,
				undoExact: true,
				editCursor,
				undoCursor: evaluate(session, "window.__fenceAccepted"),
				tracePath,
			})
		} catch (error) {
			failures.push({
				fixture: fixture.name,
				trial,
				error: String(error),
				state: evaluate(session, selectionState),
			})
			break
		}
		await Bun.write(outputPath, JSON.stringify({ results, failures }, null, 2))
	}
	await Bun.write(outputPath, JSON.stringify({ results, failures }, null, 2))
}

function arm(
	session: string,
	name: string,
	event: string,
	condition: string,
	deferred: boolean,
) {
	evaluate(
		session,
		`(()=>{let state=window.__critical={start:0,ready:0,end:0,frames:[],eventHandlersMs:null,keys:[]},previous=0;document.addEventListener("keydown",event=>state.keys.push({key:event.key,code:event.code,trusted:event.isTrusted,ctrl:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,sourceStart:document.querySelector("alkalye-editor")?.source.selectionStart,sourceEnd:document.querySelector("alkalye-editor")?.source.selectionEnd}),{once:true,capture:true});document.addEventListener(${JSON.stringify(event)},function start(event){if(event.isTrusted${event === "keydown" ? ' && event.key.toLowerCase()==="l"' : ""}){state.start=performance.now();state.key={key:event.key,code:event.code,trusted:event.isTrusted,ctrl:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,sourceStart:document.querySelector('alkalye-editor')?.source.selectionStart,sourceEnd:document.querySelector('alkalye-editor')?.source.selectionEnd};performance.mark('critical:${name}:start');document.removeEventListener(${JSON.stringify(event)},start,true)}},{capture:true});${event === "beforeinput" ? "document.addEventListener('beforeinput',event=>{if(event.isTrusted)state.eventHandlersMs=performance.now()-state.start},{once:true});" : ""}function frame(time){if(state.start&&previous)state.frames.push(time-previous);previous=time;if(state.start&&(${condition})&&!state.ready){state.ready=performance.now();performance.mark('critical:${name}:ready');${deferred ? "setTimeout(()=>{state.end=performance.now();performance.mark('critical:" + name + ":end')},3000)" : "requestAnimationFrame(()=>{state.end=performance.now();performance.mark('critical:" + name + ":end')})"}}if(!state.end)requestAnimationFrame(frame)}requestAnimationFrame(frame);return true})()`,
	)
}
function finish(session: string, name: string) {
	browser(session, "wait", "--fn", "window.__critical.end>0")
	return { name, observation: evaluate(session, "window.__critical") }
}
