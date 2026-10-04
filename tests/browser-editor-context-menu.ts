import { number, object } from "../src/shared/model"
import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "editor-context-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	console.log(url)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, "Boolean(document.querySelector('#editor'))")
	browser(session, "click", '[data-action="new"]')
	browser(session, "fill", "#editor", "hello world\n- [ ] Ship it\n")
	select(0, 5)
	rightClick(2)
	wait(
		session,
		"Boolean(document.querySelector('[data-context-menu]:popover-open'))",
	)
	assert(true, "A real right-click opens the selected text menu")
	choose("Format")
	choose("Bold")
	wait(
		session,
		"document.querySelector('#editor').value.startsWith('**hello** world')",
	)
	assert(true, "Formatting uses the clicked selection and the document journal")
	browser(session, "press", "Control+z")
	wait(
		session,
		"document.querySelector('#editor').value.startsWith('hello world')",
	)
	assert(true, "Context menu formatting participates in undo")

	select(0, 5)
	evaluate(
		session,
		"document.querySelector('#editor').dispatchEvent(new PointerEvent('contextmenu', {bubbles:true, cancelable:true, pointerType:'', clientX:20, clientY:400}))",
	)
	assert(
		evaluate(
			session,
			"document.querySelector('[data-context-menu]').matches(':popover-open') && document.querySelector('#editor').selectionStart === 0 && document.querySelector('#editor').selectionEnd === 5",
		),
		"Keyboard context menus preserve selection rather than using pointer coordinates",
	)
	browser(session, "press", "Escape")

	select(0, 7)
	rightClick(2)
	browser(session, "click", '[data-action="new"]')
	wait(session, "!document.querySelector('[data-context-menu]:popover-open')")
	assert(true, "Changing documents closes the editor's menu")

	browser(session, "fill", "#editor", "hello world\n- [ ] Ship it\n")

	select(0, 5)
	rightClick(2)
	choose("Find selection")
	wait(session, "document.querySelector('#find-text')?.value === 'hello'")
	assert(
		true,
		"Find selection opens the existing find panel with the selected text",
	)
	browser(session, "click", "#close-find")

	evaluate(
		session,
		`(() => { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('Clipboard denied')) }); return true; })()`,
	)
	select(0, 5)
	rightClick(2)
	choose("Cut")
	wait(session, "!document.querySelector('[data-context-menu]:popover-open')")
	assert(
		evaluate(
			session,
			"document.querySelector('#editor').value.startsWith('hello world')",
		),
		"Denied clipboard access never deletes selected text",
	)

	evaluate(
		session,
		`(() => { Object.defineProperty(navigator.clipboard, 'readText', { configurable: true, value: () => Promise.resolve('goodbye') }); return true; })()`,
	)
	select(0, 5)
	rightClick(2)
	choose("Paste")
	wait(
		session,
		"document.querySelector('#editor').value.startsWith('goodbye world')",
	)
	assert(true, "Paste replaces the selected range through the document journal")

	select(18, 18)
	rightClick(18)
	choose("Toggle complete")
	wait(
		session,
		"document.querySelector('#editor').value.includes('- [x] Ship it')",
	)
	assert(true, "Right-clicking a task toggles the clicked task")

	select(0, 7)
	rightClick(2)
	browser(session, "press", "Escape")
	wait(session, "!document.querySelector('[data-context-menu]:popover-open')")
	assert(
		evaluate(
			session,
			"document.activeElement === document.querySelector('#editor')",
		),
		"Escape dismisses the menu and returns focus to the editor",
	)

	select(0, 26)
	rightClick(18)
	choose("Toggle complete")
	wait(
		session,
		"document.querySelector('#editor').value.includes('- [ ] Ship it')",
	)
	assert(
		evaluate(
			session,
			"document.querySelector('#editor').value.startsWith('goodbye world')",
		),
		"A task action inside a multi-line selection affects only the clicked task",
	)

	browser(session, "fill", "#editor", "[Example](https://example.org)\n")
	evaluate(
		session,
		`(() => { Object.defineProperty(navigator.clipboard, 'writeText', {configurable:true, value: text => { window.copiedContextLink = text; return Promise.resolve() }}); return true })()`,
	)
	select(2, 2)
	rightClick(2)
	choose("Copy link")
	wait(session, "window.copiedContextLink === 'https://example.org'")
	assert(true, "Link context copies the link destination")

	browser(session, "fill", "#editor", "[[Welcome to Alkalye]]\n")
	evaluate(
		session,
		"(() => { window.originalContextOpen = window.open; window.open = url => { window.openedContextDocument = url; return null }; return true })()",
	)
	select(2, 2)
	rightClick(2)
	choose("Open document in new tab")
	assert(
		evaluate(
			session,
			"window.openedContextDocument.includes('/app/doc/') && !window.openedContextDocument.includes('Welcome')",
		),
		"Wiki-link titles resolve to normal document URLs for new tabs",
	)
	evaluate(session, "window.open = window.originalContextOpen; true")

	browser(session, "fill", "#editor", "![Icon](/icons/alkalye-icon.png)\n")
	select(2, 2)
	rightClick(2)
	choose("Preview image")
	wait(
		session,
		"document.querySelector('#dialog')?.open && document.querySelector('[data-image-preview]')?.naturalWidth > 0",
	)
	assert(true, "Image context opens the existing dialog with the image")
	browser(session, "click", '#dialog button[value="cancel"]')
	wait(session, "!document.querySelector('#dialog').open")

	select(0, 7)
	evaluate(
		session,
		"document.querySelector('#editor').dispatchEvent(new PointerEvent('contextmenu', {bubbles:true, cancelable:true, pointerType:'touch'}))",
	)
	assert(
		evaluate(
			session,
			"!document.querySelector('[data-context-menu]:popover-open')",
		),
		"Touch context menus retain browser selection controls",
	)

	select(0, 7)
	evaluate(
		session,
		"document.querySelector('#editor').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, altKey: true, clientX: 300, clientY: 100 }))",
	)
	assert(
		evaluate(
			session,
			"!document.querySelector('[data-context-menu]:popover-open')",
		),
		"Alt-right-click retains the native browser menu",
	)
	browser(session, "press", "Escape")
} finally {
	try {
		browser(session, "close")
	} finally {
		server.kill()
		await server.exited
	}
}

function select(start: number, end: number) {
	evaluate(
		session,
		`{ let editor = document.querySelector('#editor'); editor.focus(); editor.setSelectionRange(${start}, ${end}); editor.dispatchEvent(new Event('select')); }`,
	)
}
function rightClick(offset: number) {
	let point = object(
		evaluate(
			session,
			`(() => {
		let highlight = document.querySelector('#highlight');
		let walker = document.createTreeWalker(highlight, NodeFilter.SHOW_TEXT);
		let offset = ${offset}, node;
		while (node = walker.nextNode()) {
			if (offset < node.textContent.length) break;
			offset -= node.textContent.length;
		}
		if (!node) throw new Error('Missing editor coordinate');
		let range = document.createRange();
		range.setStart(node, offset); range.setEnd(node, offset + 1);
		let bounds = range.getBoundingClientRect();
		return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
	})()`,
		),
	)
	browser(
		session,
		"mouse",
		"move",
		String(Math.round(number(point.x))),
		String(Math.round(number(point.y))),
	)
	browser(session, "mouse", "down", "right")
	browser(session, "mouse", "up", "right")
}
function choose(label: string) {
	evaluate(
		session,
		`{
		let button = [...document.querySelectorAll('[data-context-menu] button')].find(button => button.checkVisibility() && button.textContent.trim().startsWith(${JSON.stringify(label)}));
		if (!button) throw new Error('Missing menu action: ' + ${JSON.stringify(label)});
		button.dataset.contextTestAction = '';
	}`,
	)
	browser(session, "click", "[data-context-test-action]")
	evaluate(
		session,
		"document.querySelectorAll('[data-context-test-action]').forEach(button => button.removeAttribute('data-context-test-action'))",
	)
}
