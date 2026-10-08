import { assert, browser, evaluate, wait } from "./tests/browser-driver"
let url = process.argv[2] ?? ""
if (!url) throw Error("URL required")
let session = "worker-recovery-" + Date.now()
let api = "window.workerEditorProof"
let source = 'document.querySelector("alkalye-editor").source'
function ready() {
	browser(session, "open", url)
	wait(
		session,
		"document.body.dataset.ready==='true'||!!document.body.dataset.failure",
	)
	assert(
		evaluate(session, "!document.body.dataset.failure"),
		"Small native recovery fixture ready",
	)
	let original = evaluate(session, `${api}.inspect().source`)
	if (typeof original !== "string") throw Error("Source missing")
	evaluate(
		session,
		`${source}.focus();${source}.setSelectionRange(${original.length},${original.length})`,
	)
	return original
}
function settled(expected: string) {
	wait(
		session,
		`${api}.inspect().source===${JSON.stringify(expected)}&&!${api}.inspect().readonly&&${api}.inspect().pending===0`,
	)
}
try {
	let original = ready()
	browser(session, "keyboard", "inserttext", "A")
	wait(session, `${api}.inspect().pending===0`)
	browser(session, "keyboard", "inserttext", "B")
	wait(session, `${api}.inspect().pending===0`)
	evaluate(session, `${api}.fault('drop-once')`)
	browser(session, "press", "Control+z")
	settled(original + "A")
	assert(
		evaluate(
			session,
			`${api}.diagnostics().requests===2&&new Set(${api}.diagnostics().requestIds).size===1`,
		),
		"Lost completed Undo reply retries exact request once, no second mutation",
	)
	assert(
		evaluate(session, `${api}.flush()`) === original + "A",
		"Lost reply retains exact local journal",
	)
	browser(session, "keyboard", "inserttext", "C")
	wait(session, `${api}.inspect().pending===0`)
	evaluate(session, `${api}.fault('hold-merge')`)
	browser(session, "press", "Control+z")
	wait(session, `${api}.diagnostics().held`)
	evaluate(
		session,
		`${source}.setSelectionRange(0,0);document.querySelector('#editor').dispatchEvent(new Event('select',{bubbles:true}));${api}.release()`,
	)
	settled(original + "A")
	assert(
		evaluate(
			session,
			`${api}.diagnostics().requests===3&&${api}.inspect().start===0`,
		),
		"Selection changed during candidate handoff retries mapping without repeating Undo",
	)
	evaluate(
		session,
		`${source}.focus();${source}.setSelectionRange(${original.length + 1},${original.length + 1})`,
	)
	browser(session, "keyboard", "inserttext", "D")
	wait(session, `${api}.inspect().pending===0`)
	evaluate(session, `${api}.fault('drop-adopt')`)
	browser(session, "press", "Control+z")
	settled(original + "A")
	assert(true, "Lost Adopt reply reconciles accepted epoch and unfreezes")
	for (let index = 0; index < 66; index++) {
		browser(session, "press", "Control+Shift+z")
		wait(session, `!${api}.inspect().readonly`)
	}
	assert(
		evaluate(session, `${api}.expiredReceipt()`),
		"Evicted original receipt rejects old sequence without replay",
	)
	assert(
		evaluate(session, `${api}.inspect().failures.length===0`),
		"Successful recovery gates report no authority failures",
	)
	evaluate(session, `${api}.dispose()`)
	browser(session, "close")
	session = "worker-recovery-" + Date.now()
	original = ready()
	browser(session, "keyboard", "inserttext", "Z")
	wait(session, `${api}.inspect().pending===0`)
	evaluate(session, `${api}.fault('drop-always')`)
	browser(session, "press", "Control+z")
	wait(session, `${api}.inspect().failures.length>0`)
	let draft = evaluate(session, `${api}.inspect().source`)
	evaluate(session, `${api}.editable(true);${api}.editable(true)`)
	browser(session, "keyboard", "inserttext", "FAIL")
	assert(
		evaluate(
			session,
			`${api}.inspect().readonly&&${api}.inspect().source===${JSON.stringify(draft)}&&${api}.inspect().failures.length===1`,
		),
		"Uncertain outcome keeps sticky readonly draft despite permission refresh",
	)
	evaluate(session, `${api}.dispose()`)
	browser(session, "close")
	session = "worker-recovery-" + Date.now()
	original = ready()
	browser(session, "keyboard", "inserttext", "K")
	wait(session, `${api}.inspect().pending===0`)
	evaluate(session, `${api}.fault('hold-undo')`)
	browser(session, "press", "Control+z")
	wait(session, `${api}.diagnostics().held`)
	evaluate(session, `${api}.dispose()`)
	assert(
		evaluate(
			session,
			`${api}.diagnostics().closed&&document.body.dataset.closed==='true'`,
		),
		"Close during completed Undo reply releases scope without waiting for transport",
	)
	evaluate(session, `${api}.dispose()`)
	browser(session, "close")
	session = "worker-recovery-" + Date.now()
	original = ready()
	browser(session, "keyboard", "inserttext", "L")
	wait(session, `${api}.inspect().pending===0`)
	evaluate(session, `${api}.fault('hold-undo');${api}.observeClosingUndo()`)
	wait(session, `${api}.diagnostics().held`)
	evaluate(session, `${api}.dispose()`)
	wait(session, `${api}.diagnostics().closeReceipt==='AppliedUnknown'`)
	assert(
		true,
		"Public queue receipt resolves AppliedUnknown when scope closes after mutation and before reply",
	)
} finally {
	browser(session, "close")
}
