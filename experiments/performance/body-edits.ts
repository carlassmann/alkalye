import * as Schema from "effect/Schema"
import { browser, evaluate, wait } from "../../tests/browser-driver"
let version = process.argv[2]
if (version !== "before" && version !== "after") throw Error("version required")
let session = "body-ab-" + version
let directory = process.argv[3],
	url = process.argv[4],
	documentPath = process.argv[5]
if (!directory || !url || !documentPath)
	throw Error(
		"Usage: bun experiments/performance/body-edits.ts before|after FIXTURE_DIRECTORY URL DOCUMENT_PATH",
	)
let Metrics = Schema.fromJsonString(
	Schema.Struct({
		handled: Schema.Number,
		first: Schema.Number,
		second: Schema.Number,
	}),
)
let source = 'document.querySelector("alkalye-editor").source'
// Copy identical profile/data fixtures and remove their HTTP, code and service-worker caches before boot.
// These event spans are not frame-rate proofs; both animation callbacks are frame opportunities.
let output: unknown[] = []
try {
	browser(
		session,
		"--profile",
		`${directory}/profile-${version}`,
		"open",
		new URL(documentPath, url).href,
	)
	evaluate(
		session,
		`(async()=>{for(let registration of await navigator.serviceWorker.getRegistrations())await registration.unregister();for(let key of await caches.keys())await caches.delete(key);return true})()`,
	)
	browser(session, "reload")
	let expectedHash = new Bun.CryptoHasher("sha256")
		.update(await Bun.file(`${directory}/${version}/dist/app.js`).arrayBuffer())
		.digest("hex")
	let actualHash = evaluate(
		session,
		`(async()=>{let bytes=await (await fetch('/app.js',{cache:'reload'})).arrayBuffer();let hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('')})()`,
	)
	if (actualHash !== expectedHash)
		throw Error("Frozen asset mismatch " + actualHash + " " + expectedHash)
	let loadedSize = evaluate(
		session,
		"performance.getEntriesByType('resource').find(entry=>entry.name.endsWith('/app.js')&&entry.initiatorType==='script')?.decodedBodySize",
	)
	if (loadedSize !== Bun.file(`${directory}/${version}/dist/app.js`).size)
		throw Error("Loaded script size mismatch " + loadedSize)
	wait(
		session,
		`Boolean(document.querySelector('#editor')) && !document.querySelector('#editor').readOnly && ${source}.value.length > 120000`,
	)
	evaluate(
		session,
		`(() => {window.bodyProbe={samples:[],armed:false};document.addEventListener('beforeinput',event=>{if(window.bodyProbe.armed&&event.isTrusted)window.bodyProbe.started=performance.now()},true);window.addEventListener('input',event=>{let state=window.bodyProbe;if(!state.armed||!event.isTrusted)return;state.armed=false;let handled=performance.now()-state.started;requestAnimationFrame(()=>{let first=performance.now()-state.started;requestAnimationFrame(()=>state.samples.push({handled,first,second:performance.now()-state.started}))})});return true})()`,
	)
	for (let scenario of ["normal", "retitle"]) {
		if (scenario === "retitle") {
			evaluate(
				session,
				`(() => {let source=${source};let start=source.value.indexOf('Benchmark 128 KB');if(start<0)throw Error('title absent');source.setSelectionRange(start,start+16);document.querySelector('#editor').focus();return true})()`,
			)
			browser(session, "keyboard", "inserttext", "Renamed")
			wait(
				session,
				`${source}.value.includes('title: Renamed') && document.querySelector('#save-status').textContent.trim() === 'Saved'`,
			)
		}
		for (let position of ["start", "middle"])
			for (let sample = 0; sample < 5; sample++) {
				evaluate(
					session,
					`(() => {let source=${source};let before=source.value;let start=${JSON.stringify(position)}==='start'?before.indexOf(String.fromCharCode(10,10))+2:Math.floor(before.length/2);source.setSelectionRange(start,start);document.querySelector('#editor').focus();window.bodyProbe.expected=before.slice(0,start)+'Z'+before.slice(start);window.bodyProbe.count=window.bodyProbe.samples.length;return true})()`,
				)
				evaluate(session, "window.bodyProbe.armed=true")
				browser(session, "keyboard", "inserttext", "Z")
				wait(
					session,
					`${source}.value === window.bodyProbe.expected && window.bodyProbe.samples.length > window.bodyProbe.count && document.querySelector('#save-status').textContent.trim() === 'Saved'`,
				)
				output.push({
					version,
					scenario,
					position,
					sample,
					...Schema.decodeUnknownSync(Metrics)(
						evaluate(
							session,
							"JSON.stringify(window.bodyProbe.samples.at(-1))",
						),
					),
				})
			}
	}
	await Bun.write(
		`${directory}/browser-${version}.json`,
		JSON.stringify(output, null, 2),
	)
	console.log(JSON.stringify({ version, samples: output.length }))
} finally {
	browser(session, "close")
}
