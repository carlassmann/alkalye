import {
	browser,
	browserBatch,
	evaluate,
	wait,
} from "../../tests/browser-driver"
let session = process.argv[2],
	profile = process.argv[3],
	url = process.argv[4]
if (!session || !profile || !url) throw Error("session profile url required")
let source = 'document.querySelector("alkalye-editor").source'
let observations: unknown[] = []
try {
	browser(
		session,
		"--profile",
		profile,
		"--args",
		"--touch-events=enabled,--blink-settings=primaryPointerType=2",
		"open",
		"about:blank",
	)
	browser(session, "set", "device", "iPhone 15")
	browser(session, "open", url)
	wait(
		session,
		`!document.querySelector('#editor')?.readOnly && ${source}?.value.length > 120000`,
	)
	evaluate(
		session,
		`(()=>{let app=document.querySelector('#app');if(app.classList.contains('library-open'))document.querySelector('[data-action=library]').click();if(app.classList.contains('tools-open'))document.querySelector('[data-action=toggle-tools]').click();return true})()`,
	)
	let state = evaluate(
		session,
		`(()=>{let native=document.querySelector('#editor');return {coarse:matchMedia('(pointer: coarse)').matches,sourceCharacters:${source}.value.length,nativeCharacters:native.value.length,overlayNodes:document.querySelector('#highlight').querySelectorAll('*').length,viewportWidth:innerWidth,scrollHeight:native.parentElement.scrollHeight}})()`,
	)
	observations.push({ phase: "ready", state })
	evaluate(
		session,
		`(()=>{window.mobileSamples=[];window.mobileStarted={};for(let type of ['beforeinput','pointerdown'])document.addEventListener(type,event=>{if(event.isTrusted)window.mobileStarted[type]=performance.now()},true);for(let [type,start] of [['input','beforeinput'],['pointerdown','pointerdown']])window.addEventListener(type,event=>{if(!event.isTrusted||!window.mobileStarted[start])return;let began=window.mobileStarted[start];let sync=performance.now()-began;requestAnimationFrame(()=>{let first=performance.now()-began;requestAnimationFrame(()=>window.mobileSamples.push({type,sync,first,second:performance.now()-began}))})});return true})()`,
	)
	for (let fraction of [0.25, 0.5, 0.75]) {
		evaluate(
			session,
			`(()=>{let host=document.querySelector('#editor').parentElement;host.scrollTop=(host.scrollHeight-host.clientHeight)*${fraction};return true})()`,
		)
		wait(session, "document.elementFromPoint(20,220)?.id === 'editor'")
		let before = evaluate(
			session,
			'document.querySelector("#editor").parentElement.scrollTop',
		)
		let count = evaluate(session, "window.mobileSamples.length")
		browserBatch(session, [
			["mouse", "move", "20", "220"],
			["mouse", "down"],
			["mouse", "up"],
		])
		wait(session, `window.mobileSamples.length>${count}`)
		observations.push({
			phase: "tap",
			fraction,
			before,
			after: evaluate(
				session,
				'document.querySelector("#editor").parentElement.scrollTop',
			),
			sample: evaluate(session, "window.mobileSamples.at(-1)"),
		})
	}
	for (let position of ["start", "middle"])
		for (let sample = 0; sample < 3; sample++) {
			evaluate(
				session,
				`(()=>{let source=${source},before=source.value;let offset=${JSON.stringify(position)}==='start'?before.indexOf(String.fromCharCode(10,10))+2:Math.floor(before.length/2);source.setSelectionRange(offset,offset);source.focus();window.mobileExpected=before.slice(0,offset)+'Z'+before.slice(offset);window.mobileCount=window.mobileSamples.length;return true})()`,
			)
			browser(session, "keyboard", "inserttext", "Z")
			wait(
				session,
				`${source}.value===window.mobileExpected && document.querySelector('#save-status').textContent==='Saved' && window.mobileSamples.length>window.mobileCount`,
			)
			observations.push({
				phase: "typing",
				position,
				sample,
				timing: evaluate(session, "window.mobileSamples.at(-1)"),
			})
		}
	await Bun.write(`/tmp/${session}.json`, JSON.stringify(observations, null, 2))
	console.log(JSON.stringify(observations))
} finally {
	browser(session, "close")
}
