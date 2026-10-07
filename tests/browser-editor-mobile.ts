import {
	assert,
	browser,
	browserBatch,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"

let session = "editor-mobile-" + Date.now()
let source = 'document.querySelector("alkalye-editor").source'
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
try {
	let origin = await serverAddress(server.stdout)
	browser(
		session,
		"--args",
		"--touch-events=enabled,--blink-settings=primaryPointerType=2",
		"open",
		"about:blank",
	)
	browser(session, "set", "device", "iPhone 15")
	browser(session, "open", new URL("/app", origin).href)
	wait(session, "Boolean(document.querySelector('#editor'))")
	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		`${source}.value === '' && !document.querySelector('#editor').readOnly`,
	)
	evaluate(
		session,
		`(()=>{window.mobileExpected=('# Mobile notes\\n\\n'+('Words **bold** ==marker== [reference](https://example.org) 😀 مرحبا\\n\\n').repeat(2500)).slice(0,131072);${source}.value=window.mobileExpected;${source}.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
	)
	wait(
		session,
		`${source}.value === window.mobileExpected && document.querySelector('#save-status').textContent === 'Saved'`,
	)
	evaluate(
		session,
		"(()=>{let app=document.querySelector('#app');if(app.classList.contains('library-open'))document.querySelector('[data-action=library]').click();if(app.classList.contains('tools-open'))document.querySelector('[data-action=toggle-tools]').click();return true})()",
	)
	assert(
		evaluate(
			session,
			`matchMedia('(pointer:coarse)').matches && document.querySelector('#editor').value.length === ${source}.projection.text.length`,
		),
		"Coarse-pointer editing retains the complete native input",
	)

	for (let fraction of [0.25, 0.5, 0.75]) {
		evaluate(
			session,
			`(()=>{let host=document.querySelector('#editor').parentElement;host.scrollTop=(host.scrollHeight-host.clientHeight)*${fraction};return true})()`,
		)
		wait(session, "document.elementFromPoint(20,220)?.id === 'editor'")
		evaluate(
			session,
			"window.mobileScrollBefore = document.querySelector('#editor').parentElement.scrollTop",
		)
		browserBatch(session, [
			["mouse", "move", "20", "220"],
			["mouse", "down"],
			["mouse", "up"],
		])
		assert(
			evaluate(
				session,
				"Math.abs(document.querySelector('#editor').parentElement.scrollTop-window.mobileScrollBefore)<=1",
			),
			"Tapping a large mobile document preserves the scroll position",
		)
		evaluate(
			session,
			`(()=>{let before=${source}.value,start=${source}.selectionStart,end=${source}.selectionEnd;window.mobileExpected=before.slice(0,start)+'Z'+before.slice(end);return true})()`,
		)
		browser(session, "keyboard", "inserttext", "Z")
		wait(
			session,
			`${source}.value === window.mobileExpected && document.querySelector('#save-status').textContent === 'Saved'`,
		)
		assert(true, "Typing after a native tap edits the selected source location")
	}

	evaluate(session, `${source}.focus()`)
	browser(session, "press", "Meta+a")
	wait(
		session,
		`${source}.selectionStart === 0 && ${source}.selectionEnd === ${source}.value.length`,
	)
	assert(
		evaluate(
			session,
			`(()=>{let data=new DataTransfer();document.querySelector('#editor').dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain')===window.mobileExpected})()`,
		),
		"Select-all and the clipboard event retain complete Markdown across the mobile document",
	)
	browser(session, "press", "ArrowRight")
	wait(session, `${source}.selectionStart === ${source}.selectionEnd`)

	evaluate(
		session,
		`(()=>{let source=${source};source.setSelectionRange(source.value.length,source.value.length);let native=document.querySelector('#editor');native.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));native.setRangeText('日本語',native.selectionStart,native.selectionEnd,'end');native.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日本語'}));window.mobileExpected+='日本語';return true})()`,
	)
	wait(
		session,
		`${source}.value === window.mobileExpected && document.querySelector('#save-status').textContent === 'Saved'`,
	)
	assert(
		true,
		"Full native input retains composition completion without a final input event",
	)

	evaluate(
		session,
		`${source}.setSelectionRange(${source}.value.length,${source}.value.length);${source}.focus()`,
	)
	browser(session, "mouse", "move", "20", "220")
	browser(session, "mouse", "down")
	evaluate(
		session,
		"window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}))",
	)
	browser(session, "mouse", "up")
	evaluate(
		session,
		`(()=>{let before=${source}.value,start=${source}.selectionStart,end=${source}.selectionEnd;window.mobileExpected=before.slice(0,start)+'!'+before.slice(end);return true})()`,
	)
	browser(session, "keyboard", "inserttext", "!")
	wait(
		session,
		`${source}.value === window.mobileExpected && document.querySelector('#save-status').textContent === 'Saved'`,
	)
	assert(
		true,
		"Pointer cancellation releases native editing on a large mobile document",
	)
} finally {
	try {
		browser(session, "close")
	} finally {
		server.kill()
		await server.exited
	}
}
