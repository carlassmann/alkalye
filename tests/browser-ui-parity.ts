import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "ui-parity-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	let shell = await fetch(url).then(response => response.text())
	assert(
		shell.includes("data-boot") && !shell.includes("<!-- APP_BOOT -->"),
		"Initial HTML includes the startup frame before JavaScript",
	)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "network", "route", new URL("/app.js", url).href, "--abort")
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-boot] [data-toolbar]") !== null')
	assert(
		evaluate(
			session,
			'!document.querySelector(".boot-line, .boot-page, #editor") && document.querySelector("[data-boot]").textContent.trim() === "" && document.querySelector("[data-toolbar]").closest("[inert]") !== null',
		),
		"Before JavaScript, the editor shows its real toolbar and an empty page",
	)
	let toolbarGeometry = `JSON.stringify([...document.querySelectorAll("[data-toolbar] button")].map(button => {let bounds = button.getBoundingClientRect(); return [button.dataset.action, bounds.x, bounds.y, bounds.width, bounds.height]}))`
	let initialToolbar = evaluate(session, toolbarGeometry)
	browser(session, "network", "unroute", new URL("/app.js", url).href)
	browser(session, "reload")
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	wait(session, 'document.querySelector("#editor") !== null')
	assert(
		evaluate(session, toolbarGeometry) === initialToolbar,
		"Opening the document keeps every toolbar control in place",
	)
	assert(
		evaluate(
			session,
			'getComputedStyle(document.querySelector("#highlight")).animationDuration === "0.12s"',
		),
		"Document text has a brief entrance without animating the layout",
	)
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
} finally {
	browser(session, "close")
	server.kill()
	await server.exited
}
