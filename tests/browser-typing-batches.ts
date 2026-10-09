import {
	assert,
	browser,
	browserBatch,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "typing-batches-" + Date.now()
let source = 'document.querySelector("alkalye-editor").source'
try {
	let origin = await serverAddress(server.stdout)
	browser(session, "open", new URL("/app?typing-batches", origin).href)
	wait(session, "Boolean(document.querySelector('[data-action=new]'))")
	browser(session, "click", "[data-action=new]")
	wait(
		session,
		`${source}.value==='' && !document.querySelector('#editor').readOnly`,
	)
	evaluate(
		session,
		`(()=>{window.typingReceipts=[];window.visibleTyping=[];document.querySelector('#editor').addEventListener('input',()=>window.visibleTyping.push(${source}.value));${source}.focus();return true})()`,
	)
	browserBatch(
		session,
		[..."abcdefgh"].map(character => ["keyboard", "inserttext", character]),
	)
	assert(
		evaluate(
			session,
			`${source}.value==='abcdefgh' && ${source}.selectionStart===8 && window.visibleTyping.join('|')==='a|ab|abc|abcd|abcde|abcdef|abcdefg|abcdefgh'`,
		),
		"Each trusted key is visible immediately, with exact caret",
	)
	wait(session, "window.typingReceipts.length===1")
	assert(
		evaluate(
			session,
			"window.typingReceipts[0].label==='Type' && window.typingReceipts[0].operations===8",
		),
		"Quiet typing burst commits one action containing eight original operations",
	)
	browser(session, "press", "Control+z")
	wait(session, `${source}.value==='' && window.typingReceipts.length===2`)
	assert(
		evaluate(session, `${source}.selectionStart===0`),
		"One trusted Undo removes the complete accepted typing group",
	)
	browser(session, "set", "offline", "on")
	browserBatch(session, [
		["keyboard", "inserttext", "Ω"],
		["keyboard", "inserttext", "😀"],
		["eval", "document.querySelector('#editor').blur();void 0"],
	])
	wait(
		session,
		`${source}.value==='Ω😀' && document.querySelector('#save-status').getAttribute('aria-busy')==='false' && Number(document.querySelector('#save-status').dataset.pending)>0`,
	)
	assert(
		evaluate(session, "window.typingReceipts.length===2"),
		"Offline blur flushes local grouping without fabricating server acceptance",
	)
	browser(session, "set", "offline", "off")
	wait(session, "window.typingReceipts.length===3")
	evaluate(session, `${source}.focus();${source}.setSelectionRange(0,0);void 0`)
	browserBatch(session, [
		["keyboard", "inserttext", "x"],
		["press", "ArrowLeft"],
		["keyboard", "inserttext", "y"],
	])
	wait(session, "window.typingReceipts.length===5")
	assert(
		evaluate(
			session,
			`${source}.value==='yxΩ😀' && window.typingReceipts[3].operations===1 && window.typingReceipts[4].operations===1`,
		),
		"Caret navigation splits typing groups before subsequent input",
	)
	browser(session, "press", "Control+z")
	wait(session, `${source}.value==='xΩ😀' && window.typingReceipts.length===6`)
	assert(true, "Undo after selection navigation removes only the later group")
	evaluate(
		session,
		`document.querySelector('#editor').dispatchEvent(new CompositionEvent('compositionstart'));void 0`,
	)
	browser(session, "keyboard", "inserttext", "仮")
	assert(
		evaluate(
			session,
			`${source}.value.includes('仮') && window.typingReceipts.length===6`,
		),
		"Composition remains visible before its completion boundary",
	)
	evaluate(
		session,
		`document.querySelector('#editor').dispatchEvent(new CompositionEvent('compositionend',{data:'仮'}));void 0`,
	)
	wait(session, "window.typingReceipts.length===7")
	assert(
		evaluate(session, "window.typingReceipts[6].operations===1"),
		"Completed composition persists separately from ordinary typing",
	)
	browser(session, "press", "Control+z")
	wait(session, `${source}.value==='xΩ😀' && window.typingReceipts.length===8`)
	assert(true, "Undo after composition preserves the prior typing group")
	browser(session, "reload")
	wait(
		session,
		`${source}.value==='xΩ😀' && !document.querySelector('#editor').readOnly`,
	)
	assert(true, "Offline grouped Unicode survives reload and reconnect")
} catch (error) {
	console.error(
		"Typing boundary witness",
		evaluate(
			session,
			`({source:${source}.value,caret:${source}.selectionStart,receipts:window.typingReceipts,status:document.querySelector('#save-status')?.textContent,pending:document.querySelector('#save-status')?.dataset.pending})`,
		),
	)
	throw error
} finally {
	try {
		browser(session, "set", "offline", "off")
		browser(session, "close")
	} catch {}
	server.kill()
	await server.exited
}
