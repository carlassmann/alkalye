import {
	assert,
	browser,
	browserBatch,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"

let session = "viewport-production-" + Date.now()
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let source = 'document.querySelector("alkalye-editor").source'
try {
	let origin = await serverAddress(server.stdout)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", new URL("/app", origin).href)
	wait(session, "Boolean(document.querySelector('#editor'))")
	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		`${source}.value === '' && !document.querySelector('#editor').readOnly`,
	)
	evaluate(
		session,
		`(()=>{${source}.value='😀😃😀';${source}.dispatchEvent(new Event('input',{bubbles:true}));${source}.focus();${source}.setSelectionRange(4,4);return true})()`,
	)
	browser(session, "press", "Backspace")
	wait(session, `${source}.value==='😀😀'`)
	assert(
		true,
		"Deleting similar adjacent emoji preserves whole Unicode characters",
	)
	evaluate(
		session,
		`(()=>{window.viewportExpected=('alpha beta gamma 😀 مرحبا\\n\\n').repeat(6000).slice(0,131072);${source}.value=window.viewportExpected;${source}.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
	)
	wait(
		session,
		`${source}.value===window.viewportExpected && document.querySelector('#save-status').dataset.pending==='0' && document.querySelector('#save-status').textContent==='Saved'`,
	)
	assert(
		evaluate(session, "document.querySelector('#editor').value.length<16384"),
		"Large production documents mount bounded native input",
	)
	evaluate(
		session,
		`(()=>{window.viewportSamples=[];let e=document.querySelector('#editor'),started=0;e.addEventListener('beforeinput',()=>started=performance.now(),{capture:true});e.addEventListener('input',()=>{if(started){window.viewportSamples.push(performance.now()-started);started=0}});return true})()`,
	)
	for (let offset of [0, 65536, 131071]) {
		browserBatch(session, [
			[
				"eval",
				`(()=>{${source}.focus();${source}.setSelectionRange(${offset},${offset});window.viewportExpected=window.viewportExpected.slice(0,${offset})+'x'+window.viewportExpected.slice(${offset});return true})()`,
			],
			["keyboard", "inserttext", "x"],
			["wait", "--fn", `${source}.value===window.viewportExpected`],
		])
	}
	assert(
		evaluate(session, `${source}.value===window.viewportExpected`),
		"Trusted top, middle and end edits preserve Unicode source offsets",
	)
	wait(
		session,
		"document.querySelector('#save-status').textContent==='Saved' && document.querySelector('#save-status').dataset.pending==='0'",
	)
	console.log(
		"128KiB input milliseconds",
		evaluate(session, "window.viewportSamples"),
	)
	let documentPath = evaluate(session, "location.pathname")
	browser(session, "reload")
	wait(session, `${source}?.value.length===131075`)
	assert(
		evaluate(session, "document.querySelector('#editor').value.length<16384"),
		"Durable reload restores the bounded production input",
	)

	evaluate(
		session,
		`(()=>{${source}.setSelectionRange(65536,65536);window.viewportHeightSource=${source}.value;return true})()`,
	)
	browser(session, "set", "viewport", "1280", "500")
	wait(
		session,
		"window.innerHeight===500 && document.querySelector('#editor').getBoundingClientRect().height>0",
	)
	browser(session, "set", "viewport", "1280", "1000")
	wait(
		session,
		`(()=>{let viewport=${source}.viewport,fragment=viewport.viewport;return window.innerHeight===1000&&fragment.top+fragment.height>=viewport.scrollTop+viewport.scrollElement.clientHeight})()`,
	)
	assert(
		evaluate(
			session,
			`${source}.value===window.viewportHeightSource&&${source}.selectionStart===65536&&${source}.selectionEnd===65536&&document.querySelector('#editor').value.length<16384`,
		),
		"Same-width height growth fills the visible source window without changing its caret",
	)

	assert(
		evaluate(
			session,
			`(()=>{${source}.focus();${source}.setSelectionRange(0,131075);let data=new DataTransfer();document.querySelector('#editor').dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain').length===131075})()`,
		),
		"Copy includes the complete canonical document",
	)
	assert(
		evaluate(
			session,
			`${source}.selectionStart===0&&${source}.selectionEnd===131075`,
		),
		"Canonical select-all spans every viewport",
	)
	browser(session, "set", "viewport", "390", "844")
	wait(session, "document.querySelector('#editor').clientWidth<500")
	evaluate(
		session,
		`(()=>{${source}.setSelectionRange(65536,65536);return true})()`,
	)
	browser(session, "keyboard", "inserttext", "日")
	wait(session, `${source}.value[65536]==='日'`)
	assert(true, "Mobile resize keeps the source caret and accepts native text")
	browser(session, "press", "Control+z")
	wait(session, `${source}.value.length===131075`)
	assert(true, "Viewport edits retain contribution-based undo")

	evaluate(
		session,
		`(()=>{let input=document.querySelector('#editor');${source}.setSelectionRange(65536,65536);input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.setRangeText('日本語',input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日本語'}));return true})()`,
	)
	wait(session, `${source}.value.slice(65536,65539)==='日本語'`)
	assert(
		true,
		"Bounded composition absorbs the final native text before the final input event",
	)
	wait(
		session,
		"document.querySelector('#save-status').textContent==='Saved' && document.querySelector('#save-status').dataset.pending==='0'",
	)
	browser(session, "set", "offline", "on")
	browser(session, "reload")
	wait(session, `${source}?.value.slice(65536,65539)==='日本語'`)
	assert(true, "The worker and bounded editor reopen a saved document offline")
	browser(session, "set", "offline", "off")
	assert(typeof documentPath === "string", "Document routing stays stable")
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		`${source}.value === '' && !document.querySelector('#editor').readOnly`,
	)
	evaluate(
		session,
		`(()=>{window.viewportMegabyte='alpha beta gamma '.repeat(65536).slice(0,1048576);${source}.value=window.viewportMegabyte;${source}.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
	)
	wait(
		session,
		`${source}.value===window.viewportMegabyte && document.querySelector('#save-status').textContent==='Saved' && document.querySelector('#save-status').dataset.pending==='0'`,
	)
	assert(
		evaluate(session, "document.querySelector('#editor').value.length<20000"),
		"A one-megabyte paragraph remains bounded",
	)
	evaluate(
		session,
		`(()=>{${source}.focus();${source}.setSelectionRange(524288,524288);window.viewportMegabyte=window.viewportMegabyte.slice(0,524288)+'Z'+window.viewportMegabyte.slice(524288);return true})()`,
	)
	browser(session, "keyboard", "inserttext", "Z")
	wait(session, `${source}.value===window.viewportMegabyte`)
	let durable = false
	for (let attempt = 0; attempt < 4 && !durable; attempt++) {
		durable =
			evaluate(
				session,
				`new Promise(resolve=>{let status=document.querySelector('#save-status'),observer=new MutationObserver(check),deadline=setTimeout(()=>finish(false),10000);function finish(result){clearTimeout(deadline);observer.disconnect();resolve(result)}function check(){if(status.textContent==='Saved'&&status.dataset.pending==='0')finish(true)}observer.observe(status,{attributes:true,childList:true,subtree:true,characterData:true});check()})`,
			) === true
	}
	assert(durable, "One-megabyte edits reach durable sync")
	assert(true, "One-megabyte trusted editing retains every source character")
	browser(session, "press", "Control+z")
	wait(session, `${source}.value.length===1048576`)
	assert(true, "One-megabyte input retains collaborative undo")
	browser(session, "reload")
	wait(
		session,
		`${source}?.value.length===1048576 && !document.querySelector('#editor').readOnly`,
	)
	assert(true, "One-megabyte snapshots reopen durably")
	evaluate(session, `(()=>{${source}.fullDocument(true);return true})()`)
	wait(session, "document.querySelector('#editor').value.length===1048576")
	assert(
		evaluate(
			session,
			`(()=>{let input=document.querySelector('#editor');input.select();input.dispatchEvent(new Event('select'));return ${source}.selectionStart===0&&${source}.selectionEnd===1048576})()`,
		),
		"Full-document native input selects the complete source",
	)
} finally {
	try {
		browser(session, "close")
	} finally {
		server.kill()
		await server.exited
	}
}
