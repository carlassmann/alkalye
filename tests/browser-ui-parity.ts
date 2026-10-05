import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "ui-parity-" + Date.now()
let fontSession = session + "-fonts"
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	await fetch(new URL("/__tests/fonts?pause=true", url))
	browser(fontSession, "open", "about:blank")
	evaluate(
		fontSession,
		`setTimeout(() => location.assign(${JSON.stringify(url)}), 0); true`,
	)
	wait(fontSession, 'document.querySelector("#editor") !== null')
	assert(
		evaluate(
			fontSession,
			'document.fonts.status === "loading" && document.querySelector("#app").getAttribute("aria-busy") === "true" && !document.querySelector("[data-toolbar]").checkVisibility({visibilityProperty: true}) && getComputedStyle(document.querySelector("#highlight")).animationName === "none"',
		),
		"Chrome stays hidden and the text animation waits while fonts load",
	)
	await fetch(new URL("/__tests/fonts", url))
	wait(fontSession, '!document.querySelector("#app").hasAttribute("aria-busy")')
	assert(
		evaluate(
			fontSession,
			'document.fonts.status === "loaded" && document.querySelector("[data-toolbar]").checkVisibility({visibilityProperty: true})',
		),
		"The document and its chrome appear with their final fonts",
	)
	let shell = await fetch(url).then(response => response.text())
	assert(
		shell.includes("data-boot") && !shell.includes("<!-- APP_BOOT -->"),
		"Initial HTML includes the startup frame before JavaScript",
	)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "network", "route", new URL("/app.js", url).href, "--abort")
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-boot]") !== null')
	assert(
		evaluate(
			session,
			'!document.querySelector(".boot-line, .boot-page, #editor, [data-toolbar]") && document.querySelector("[data-boot]").textContent.trim() === ""',
		),
		"Before JavaScript, no document-dependent controls or placeholder text render",
	)
	browser(session, "network", "unroute", new URL("/app.js", url).href)
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#editor") !== null && !document.querySelector("#app").hasAttribute("aria-busy")',
	)
	assert(
		evaluate(
			session,
			`document.querySelector("#app").hasAttribute("data-document-ready") && !document.querySelector('[data-action="slideshow"], [data-action="teleprompter"]')`,
		),
		"A loaded regular document shows its UI without presentation tools",
	)
	assert(
		evaluate(
			session,
			'getComputedStyle(document.querySelector("#highlight")).animationDuration === "0.12s"',
		),
		"Document text has a brief entrance without animating the layout",
	)
	let documentPath = evaluate(session, "location.pathname")
	assert(typeof documentPath === "string", "Document has a route")
	browser(session, "click", '[data-action="toggle-tools"]')
	browser(session, "open", new URL("/app/doc/never-answer", url).href)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	assert(
		evaluate(
			session,
			'document.querySelector("#app").getAttribute("aria-busy") === "true" && !document.querySelector("[data-toolbar]").checkVisibility({visibilityProperty: true}) && !document.querySelector("[data-inspector]").checkVisibility({visibilityProperty: true}) && document.querySelector("#inspector-body").textContent === ""',
		),
		"While the document snapshot is pending, chrome and tools stay invisible",
	)
	browser(session, "open", new URL(String(documentPath), url).href)
	wait(session, 'document.querySelector("#editor") !== null')
	browser(session, "click", '[data-action="palette"]')
	assert(
		evaluate(
			session,
			'!document.querySelector(\'[data-command="slideshow"], [data-command="teleprompter"]\')',
		),
		"Regular documents have no presentation commands in the palette",
	)
	browser(session, "press", "Escape")

	browser(
		session,
		"open",
		new URL(String(documentPath) + "/slideshow", url).href,
	)
	wait(
		session,
		'document.querySelector("#editor") !== null && !location.pathname.endsWith("/slideshow")',
	)
	assert(
		evaluate(session, '!document.querySelector("alkalye-presentation")'),
		"Direct presentation URLs return regular documents to the editor",
	)
	browser(session, "fill", "#editor", "---\nmode: present\n---\n# Slide")
	wait(
		session,
		"document.querySelector('[data-action=\"slideshow\"]') !== null && document.querySelector('[data-action=\"teleprompter\"]') !== null",
	)
	browser(session, "click", '[data-action="slideshow"]')
	wait(session, 'document.querySelector("alkalye-presentation") !== null')
	evaluate(session, "document.querySelector('[data-action=\"new\"]').click()")
	wait(
		session,
		'document.querySelector("#editor") !== null && !location.pathname.endsWith("/slideshow")',
	)
	browser(session, "back")
	wait(
		session,
		'document.querySelector("alkalye-presentation") !== null && location.pathname.endsWith("/slideshow")',
	)
	assert(
		true,
		"Opening a regular document from a slideshow preserves the presentation in Back history",
	)

	browser(session, "press", "Escape")
	wait(session, 'document.querySelector("#editor") !== null')
	browser(
		session,
		"fill",
		"#editor",
		"---\nmode: presentation\n---\n# Regular document",
	)
	wait(
		session,
		'!document.querySelector(\'[data-action="slideshow"], [data-action="teleprompter"]\')',
	)
	assert(
		true,
		"Presentation controls follow the exact mode frontmatter as it changes",
	)
	browser(
		session,
		"open",
		new URL("/app/doc/missing-document/teleprompter", url).href,
	)
	wait(
		session,
		'document.querySelector(".empty") !== null && !document.querySelector("#app").hasAttribute("aria-busy")',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-toolbar]").checkVisibility({visibilityProperty: true}) && !location.pathname.endsWith("/teleprompter")',
		),
		"A failed presentation load keeps navigation available",
	)
	browser(session, "open", new URL(String(documentPath), url).href)
	wait(session, 'document.querySelector("#editor") !== null')

	browser(session, "click", '[data-action="new"]')
	wait(session, '!document.querySelector("#editor").readOnly')
	browser(
		session,
		"fill",
		"#editor",
		"---\ntitle: Test statistics\n---\nHello world. One more sentence\n- [ ] First\n- [x] Second",
	)
	wait(
		session,
		'document.querySelector("#stats").textContent.includes("words")',
	)
	browser(session, "click", "#stats")
	wait(
		session,
		'document.querySelector("#stats-menu").matches(":popover-open")',
	)
	browser(session, "press", "s")
	browser(session, "press", "e")
	assert(
		evaluate(
			session,
			'document.activeElement.dataset.statsUnit === "sentences"',
		),
		"Menu supports buffered typeahead",
	)
	browser(session, "press", "Enter")
	wait(
		session,
		'document.querySelector("#stats").textContent.includes("sentences")',
	)
	assert(
		evaluate(
			session,
			'document.activeElement.id === "stats" && !document.querySelector("#stats-menu").matches(":popover-open")',
		),
		"Choosing a metric closes the menu and restores focus",
	)
	browser(session, "press", "ArrowDown")
	wait(
		session,
		'document.querySelector("#stats-menu").matches(":popover-open")',
	)
	browser(session, "press", "ArrowDown")
	browser(session, "press", "Space")
	wait(
		session,
		'document.querySelector("#stats").textContent === "1 / 2 tasks"',
	)
	browser(session, "click", "#stats")
	browser(session, "press", "End")
	browser(session, "press", "Home")
	assert(
		evaluate(session, 'document.activeElement.dataset.statsUnit === "words"'),
		"Home and End navigate menu boundaries",
	)
	browser(session, "press", "Escape")
	assert(
		evaluate(session, 'document.activeElement.id === "stats"'),
		"Escape returns focus to the trigger",
	)
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#stats")?.textContent === "1 / 2 tasks"',
	)
	assert(true, "Selected statistic survives a refresh")
	wait(
		session,
		'document.querySelector("#save-status").hasAttribute("data-quiet")',
	)
	browser(session, "wait", "1500")
	browser(session, "click", "#editor")
	browser(session, "keyboard", "type", " quickly typed words")
	assert(
		evaluate(
			session,
			'Number(getComputedStyle(document.querySelector("#save-status")).opacity) === 0',
		),
		"Fast typing keeps the save indicator invisible",
	)
	evaluate(
		session,
		`(() => {
		let picker = document.createElement("alkalye-picker");
		picker.id = "test-picker";
		picker.setChoices([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "g", label: "Gamma" }], "b");
		picker.style.cssText = "position:fixed;top:80px;left:80px;z-index:100";
		document.body.append(picker);
		return true;
	})()`,
	)
	assert(
		evaluate(session, 'document.querySelector("#test-picker").value === "b"'),
		"Picker respects a value configured before connection",
	)
	browser(session, "click", "#test-picker .menu-trigger")
	browser(session, "wait", "150")
	assert(
		evaluate(
			session,
			`(() => {
			let trigger = document.querySelector("#test-picker .menu-trigger").getBoundingClientRect();
			let selected = document.querySelector('#test-picker [aria-selected="true"]').getBoundingClientRect();
			return Math.abs(trigger.top + trigger.height / 2 - selected.top - selected.height / 2) < 2;
		})()`,
		),
		"Select aligns its selected item with the trigger",
	)
	browser(session, "press", "End")
	evaluate(
		session,
		'document.querySelector("#test-picker").setChoices([{value:"a",label:"Alpha"},{value:"b",label:"Beta"},{value:"g",label:"Gamma updated"}],"b");true',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#test-picker .menu-popover").matches(":popover-open") && document.activeElement.dataset.value === "g"',
		),
		"Updating picker choices preserves an open menu and its focus",
	)
	browser(session, "press", "Escape")
	evaluate(
		session,
		'(() => {let picker=document.querySelector("#test-picker");picker.remove();document.body.append(picker);return picker.value})()',
	)
	assert(
		evaluate(session, 'document.querySelector("#test-picker").value === "b"'),
		"Reconnecting a picker preserves its selected value",
	)
	evaluate(session, 'document.querySelector("#test-picker").remove();true')
	browser(session, "click", '[data-action="new-workspace"]')
	wait(session, 'document.querySelector("#dialog").open')
	browser(session, "wait", "150")
	assert(
		evaluate(
			session,
			`(() => {
			let dialog = document.querySelector("#dialog");
			let style = getComputedStyle(dialog);
			return dialog.getBoundingClientRect().width === 384 && style.boxShadow === "none" && document.activeElement.name === "name";
		})()`,
		),
		"Dialog matches original width and focuses its main input",
	)
	browser(session, "press", "Escape")
	wait(session, '!document.querySelector("#dialog").open')
	browser(session, "click", '[data-action="new-workspace"]')
	wait(session, 'document.querySelector("#dialog").open')
	browser(session, "mouse", "move", "4", "4")
	browser(session, "mouse", "down")
	browser(session, "mouse", "up")
	wait(session, '!document.querySelector("#dialog").open')
	assert(true, "Dialog dismisses on an outside click")
	browser(session, "click", '[data-action="palette"]')
	wait(session, 'document.querySelector("#command-search") !== null')
	browser(session, "wait", "150")
	assert(
		evaluate(
			session,
			'document.querySelector("#dialog").getBoundingClientRect().width === 512 && document.activeElement.id === "command-search"',
		),
		"Command palette matches original width and keeps search focused",
	)
	browser(session, "press", "ArrowDown")
	assert(
		evaluate(
			session,
			'document.activeElement.id === "command-search" && document.querySelector("#command-search").getAttribute("aria-activedescendant") === "command-preview"',
		),
		"Command palette arrows select commands without moving focus",
	)
	browser(session, "fill", "#command-search", "does-not-exist")
	assert(
		evaluate(
			session,
			'!document.querySelector("#command-search").hasAttribute("aria-activedescendant") && document.querySelector(".command-empty") !== null',
		),
		"An empty command search clears its active option",
	)
	browser(session, "fill", "#command-search", "Preview")
	browser(session, "press", "Enter")
	wait(
		session,
		'location.pathname.endsWith("/preview") && document.querySelector("#preview")?.shadowRoot !== null',
	)
	assert(
		evaluate(
			session,
			'document.querySelector(".preview-header").checkVisibility() && !document.querySelector("[data-statusbar]").checkVisibility() && !document.querySelector("[data-toolbar]").checkVisibility()',
		),
		"Preview has a separate route and reading frame",
	)
	browser(session, "click", ".preview-back")
	wait(
		session,
		'!location.pathname.endsWith("/preview") && document.querySelector("#editor") !== null',
	)
	assert(true, "Preview links back to the document editor")
	browser(session, "set", "media", "dark", "reduced-motion")
	assert(
		evaluate(
			session,
			'getComputedStyle(document.querySelector("#highlight")).animationName === "none"',
		),
		"Reduced motion opens document text without an entrance animation",
	)

	wait(session, "navigator.serviceWorker.controller !== null")
	evaluate(
		session,
		'caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("alkalye-")).map(async key => {let cache = await caches.open(key); await cache.put("/app.js", new Response("throw 1", {headers: {"content-type": "text/javascript"}}))})))',
	)
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#editor") !== null && !document.querySelector("#app").hasAttribute("aria-busy")',
	)
	assert(
		evaluate(
			session,
			'!document.querySelector(\'[data-action="slideshow"], [data-action="teleprompter"]\')',
		),
		"Development reload fetches current code instead of a cached older application",
	)
	browser(session, "set", "offline", "on")
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#editor") !== null && !document.querySelector("#app").hasAttribute("aria-busy")',
	)
	assert(true, "The refreshed development build still opens offline")
	browser(session, "set", "offline", "off")
} finally {
	browser(fontSession, "close")
	browser(session, "close")
	server.kill()
	await server.exited
}
