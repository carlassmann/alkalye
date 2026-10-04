import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let sessions: string[] = []
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	console.log(url)
	for (let mobile of [false, true]) {
		let session = "floating-" + (mobile ? "touch-" : "mouse-") + Date.now()
		sessions.push(session)
		if (mobile)
			browser(
				session,
				"--args",
				"--touch-events=enabled,--blink-settings=primaryPointerType=2",
				"open",
				"about:blank",
			)
		if (mobile) browser(session, "set", "device", "iPhone 15")
		else browser(session, "set", "viewport", "1280", "800")
		browser(session, "open", url)
		wait(session, "Boolean(document.querySelector('#editor'))")
		browser(session, "click", '[data-action="new"]')
		browser(session, "fill", "#editor", "- [ ] Ship it https://example.org\n")
		evaluate(
			session,
			`{ let editor = document.querySelector('#editor'); editor.setSelectionRange(3, 3); editor.dispatchEvent(new Event('select')); if (document.querySelector('#app').classList.contains('library-open')) document.querySelector('[data-action="library"]').click(); editor.focus(); }`,
		)
		wait(
			session,
			"document.querySelector('[data-line-actions]').checkVisibility() && document.querySelector('[data-line-actions]').getAnimations().length === 0",
		)
		assert(
			evaluate(
				session,
				`(() => {
					let toolbar = document.querySelector('[data-line-actions]');
					let style = getComputedStyle(toolbar);
					let bounds = toolbar.getBoundingClientRect();
					let buttons = [...toolbar.children];
					return style.position === 'fixed' && style.flexDirection === 'column' && Math.abs(innerWidth - bounds.right - 16) < 1 && Math.abs(innerHeight - bounds.bottom - 16) < 1 && buttons.length === 2 && buttons.every(button => button.querySelector('svg'));
				})()`,
			),
			(mobile ? "Touch" : "Mouse") +
				" SVG actions stack at the viewport corner",
		)
		assert(
			evaluate(
				session,
				`(() => {
					let button = document.querySelector('[data-line-actions] button');
					let style = getComputedStyle(button);
					let brand = document.documentElement.dataset.appearance === 'dark' ? 'oklch(0.65' : 'oklch(0.596';
					let matches = button.offsetWidth === ${mobile ? 44 : 32} && style.backgroundColor.startsWith(brand) && style.color === 'rgb(255, 255, 255)' && style.boxShadow !== 'none';
					if (!matches) throw new Error(JSON.stringify({width:button.offsetWidth, background:style.backgroundColor, color:style.color, appearance:document.documentElement.dataset.appearance, coarse:matchMedia('(pointer:coarse)').matches}));
					return matches;
				})()`,
			),
			(mobile ? "44px touch" : "32px mouse") +
				" buttons match the original green style",
		)
		browser(
			session,
			"screenshot",
			"/tmp/alkalye-floating-" + (mobile ? "touch" : "mouse") + ".png",
		)
		browser(session, "click", "[data-line-actions] button")
		wait(session, "document.querySelector('#editor').value.startsWith('- [x]')")
		assert(true, "Floating task action preserves its document edit")
		if (mobile) {
			evaluate(
				session,
				"Object.defineProperty(visualViewport, 'height', {configurable:true, value:visualViewport.height - 300}); visualViewport.dispatchEvent(new Event('resize'))",
			)
			wait(
				session,
				"document.querySelector('[data-line-actions]').hasAttribute('data-keyboard')",
			)
			assert(
				evaluate(
					session,
					"parseFloat(document.querySelector('[data-line-actions]').style.getPropertyValue('--floating-bottom')) >= 300",
				),
				"Visual viewport changes lift actions above the screen keyboard",
			)
			evaluate(
				session,
				"Object.defineProperty(visualViewport, 'offsetTop', {configurable:true, value:300}); visualViewport.dispatchEvent(new Event('scroll'))",
			)
			wait(
				session,
				"!document.querySelector('[data-line-actions]').hasAttribute('data-keyboard')",
			)
			assert(
				true,
				"Viewport scrolling without a bottom inset does not count as a keyboard",
			)
			evaluate(
				session,
				"delete visualViewport.height; delete visualViewport.offsetTop; visualViewport.dispatchEvent(new Event('resize'))",
			)
			wait(
				session,
				"!document.querySelector('[data-line-actions]').hasAttribute('data-keyboard')",
			)
		} else {
			browser(session, "click", '[data-action="toggle-tools"]')
			evaluate(session, "document.querySelector('#editor').focus()")
			wait(
				session,
				"document.querySelector('[data-line-actions]').getAnimations().length === 0",
			)
			assert(
				evaluate(
					session,
					"Math.abs(innerWidth - document.querySelector('[data-line-actions]').getBoundingClientRect().right - 240) < 1",
				),
				"Desktop actions stay beside the inspector",
			)
		}
		assert(
			evaluate(
				session,
				"document.activeElement === document.querySelector('#editor')",
			),
			"Floating actions preserve editor focus",
		)
		browser(session, "click", '[data-action="preview"]')
		wait(session, "!document.querySelector('[data-line-actions]')")
		assert(true, "Leaving the editor releases the floating toolbar")
	}
} finally {
	for (let session of sessions) browser(session, "close")
	server.kill()
	await server.exited
}
