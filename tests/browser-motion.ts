import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "motion-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	console.log(url)
	browser(session, "set", "viewport", "390", "844")
	browser(session, "open", url)
	wait(
		session,
		"Boolean(document.querySelector('#editor')) && Boolean(document.querySelector('[data-action=library]'))",
	)
	for (let width of [1280, 390]) {
		browser(session, "set", "viewport", String(width), "844")
		evaluate(
			session,
			'localStorage.setItem("alkalye-layout", JSON.stringify({library:true,tools:false}));true',
		)
		evaluate(session, "window.motionReloadMarker = true; true")
		browser(session, "reload")
		wait(
			session,
			"!window.motionReloadMarker && Boolean(document.querySelector('#editor')) && Boolean(document.querySelector('[data-action=library]'))",
		)
		assert(
			evaluate(
				session,
				`(() => {
			let app = document.querySelector("#app");
			return app.classList.contains("library-open") && !app.hasAttribute("data-layout-motion") &&
				[app, app.querySelector("[data-library]"), app.querySelector("[data-inspector]"), app.querySelector(".workspace")].every(node => getComputedStyle(node).transitionDuration === "0s" && node.getAnimations().length === 0);
		})()`,
			),
			"Restored sidebars appear without animation at " + width + "px",
		)
	}
	evaluate(
		session,
		`document.querySelector('[data-action="library"]').click();true`,
	)
	wait(
		session,
		'document.querySelector("[data-library]").getAnimations().length === 0',
	)
	assert(
		evaluate(
			session,
			`(() => {
				document.querySelector('[data-action="library"]').click();
				let panel = document.querySelector('[data-library]');
				let properties = panel.getAnimations().map(animation => animation.transitionProperty);
				return properties.includes('transform') && properties.includes('box-shadow');
			})()`,
		),
		"Mobile document panel slides into view while its backdrop fades",
	)
	evaluate(
		session,
		"Promise.all(document.querySelector('[data-library]').getAnimations().map(animation => animation.finished))",
	)
	browser(session, "click", "#workspace")
	browser(session, "click", "#workspace")
	assert(
		evaluate(
			session,
			"!document.querySelector('alkalye-workspace-menu .menu-popover').matches(':popover-open')",
		),
		"Native popover trigger closes its menu instead of reopening it",
	)
	browser(session, "focus", "#workspace")
	browser(session, "press", "Enter")
	wait(
		session,
		"document.activeElement?.getAttribute('aria-checked') === 'true'",
	)
	assert(true, "Keyboard activation focuses the selected workspace")
	assert(
		evaluate(
			session,
			"getComputedStyle(document.querySelector('alkalye-workspace-menu .menu-popover')).transitionProperty.includes('overlay')",
		),
		"Workspace menu keeps its native top layer during dismissal",
	)
	assert(
		evaluate(
			session,
			`(() => {
				let menu = document.querySelector('alkalye-workspace-menu .menu-popover');
				menu.hidePopover();
				return menu.getAnimations().some(animation => animation.transitionProperty === 'opacity');
			})()`,
		),
		"Workspace menu fades on close",
	)
	wait(
		session,
		"document.querySelector('alkalye-workspace-menu .menu-popover').getAnimations().length === 0",
	)
	browser(session, "click", '[data-action="new-workspace"]')
	wait(session, "document.querySelector('#dialog').open")
	assert(
		evaluate(
			session,
			`(() => {
				let dialog = document.querySelector('#dialog');
				dialog.close();
				return dialog.getAnimations().some(animation => animation.transitionProperty === 'opacity');
			})()`,
		),
		"Dialog fades on close without delaying native close state",
	)
	wait(
		session,
		"document.querySelector('#dialog').getAnimations().length === 0",
	)
	evaluate(
		session,
		`document.querySelector('.document-row').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:innerWidth - 1, clientY:innerHeight - 1}))`,
	)
	wait(
		session,
		"Boolean(document.querySelector('[data-context-menu]:popover-open'))",
	)
	evaluate(
		session,
		"Promise.all(document.querySelector('[data-context-menu]').getAnimations().map(animation => animation.finished))",
	)
	assert(
		evaluate(
			session,
			`(() => {
				let bounds = document.querySelector('[data-context-menu]').getBoundingClientRect();
				return bounds.right <= innerWidth - 8 && bounds.bottom <= innerHeight - 8;
			})()`,
		),
		"Context menu stays inside the viewport after its scale transition",
	)
	assert(
		evaluate(
			session,
			`(() => {
				let menu = document.querySelector('[data-context-menu]');
				menu.hidePopover();
				return menu.isConnected && menu.getAnimations().length > 0;
			})()`,
		),
		"Context menu remains mounted for its exit transition",
	)
	wait(session, "!document.querySelector('[data-context-menu]')")
	assert(true, "Context menu releases its DOM after dismissal")
	browser(session, "set", "media", "reduced-motion")
	assert(
		evaluate(
			session,
			`(() => {
				let dialog = document.querySelector('#dialog');
				dialog.showModal();
				return matchMedia('(prefers-reduced-motion: reduce)').matches && dialog.getAnimations().length === 0 && getComputedStyle(dialog, '::backdrop').transitionDuration === '0s';
			})()`,
		),
		"Reduced motion disables dialog and backdrop animations",
	)
	evaluate(session, "document.querySelector('#dialog').close()")
	assert(
		evaluate(
			session,
			`(() => {
				document.querySelector('[data-action="library"]').click();
				return document.querySelector('[data-library]').getAnimations().length === 0;
			})()`,
		),
		"Reduced motion disables sidebar transitions",
	)
	browser(session, "set", "media", "light")
	browser(session, "set", "viewport", "1280", "800")
	assert(
		evaluate(
			session,
			`(() => {
				document.querySelector('[data-action="library"]').click();
				let app = document.querySelector('#app');
				let icon = document.querySelector('[data-toolbar] .open-icon');
				return app.getAnimations().some(animation => animation.transitionProperty === 'grid-template-columns') && icon.getAnimations().some(animation => animation.transitionProperty === 'filter') && document.querySelector('[data-library]').offsetWidth === 224;
			})()`,
		),
		"Desktop sidebar resizes the editor and crossfades its toggle icon",
	)
} finally {
	browser(session, "close")
	server.kill()
	await server.exited
}
