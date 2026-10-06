import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "ui-leftovers-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	browser(session, "set", "viewport", "1440", "900")
	browser(
		session,
		"open",
		new URL("/app", new TextDecoder().decode(output.value).trim()).href,
	)
	wait(
		session,
		'Boolean(document.querySelector("#editor")) && !document.querySelector("#app").hasAttribute("aria-busy")',
	)
	let path = evaluate(session, "location.pathname")
	browser(session, "click", '[data-action="profile-menu"]')
	assert(
		evaluate(
			session,
			'document.querySelector("#profile-menu").matches(":popover-open")',
		) && evaluate(session, "location.pathname") === path,
		"Account button opens a dropdown without navigating",
	)
	assert(
		evaluate(
			session,
			'[...document.querySelectorAll("#profile-menu > button, #profile-menu > alkalye-menu > button")].every(button=>button.querySelector("svg"))',
		),
		"Account dropdown entries have icons",
	)
	assert(
		evaluate(
			session,
			'[...document.querySelectorAll(\'#profile-menu [data-action="sign-in"], #profile-menu [data-action="sign-out"]\')].filter(button=>!button.hidden).length === 1',
		),
		"Account menu shows one authentication action",
	)
	browser(session, "screenshot", "/tmp/alkalye-account-menu.png")
	browser(session, "press", "Escape")
	browser(session, "click", '[data-action="appearance-dark"]')
	wait(session, 'document.documentElement.dataset.appearance === "dark"')
	assert(
		evaluate(
			session,
			'document.querySelector(\'[data-action="appearance-dark"]\').getAttribute("aria-checked") === "true"',
		),
		"Account theme choices save and reflect their state",
	)
	browser(session, "click", '[data-action="language-de"]')
	wait(
		session,
		`document.querySelector('[data-profile-label="Theme"]').textContent === "Design"`,
	)
	assert(
		evaluate(
			session,
			`document.querySelector('[data-profile-label="Light"]').textContent === "Hell"`,
		),
		"Account submenu labels follow the chosen language",
	)
	browser(session, "click", '[data-action="language-en"]')
	browser(session, "click", '[data-action="new"]')
	browser(session, "fill", "#editor", "First line\nSecond line\nThird line\n")
	evaluate(
		session,
		'(() => {let editor=document.querySelector("#editor");editor.focus();editor.setSelectionRange(0,0);return true})()',
	)
	let firstTop = Number(
		evaluate(
			session,
			'parseFloat(document.querySelector(".active-line").style.top)',
		),
	)
	browser(session, "press", "ArrowDown")
	wait(
		session,
		`parseFloat(document.querySelector(".active-line").style.top) > ${firstTop}`,
	)
	assert(
		true,
		"Cursor-line highlighting follows keyboard movement through plain text",
	)
	evaluate(
		session,
		'(() => {let editor=document.querySelector("#editor");editor.setSelectionRange(editor.value.length,editor.value.length);return true})()',
	)
	assert(
		evaluate(
			session,
			'parseFloat(document.querySelector(".active-line").style.top)>0',
		),
		"An empty final line has a valid cursor highlight",
	)
	assert(
		evaluate(
			session,
			'(() => {let probe=document.createElement("span");probe.style.color=getComputedStyle(document.querySelector("#editor")).getPropertyValue("--editor-caret");document.body.append(probe);let expected=getComputedStyle(probe).color;probe.remove();return getComputedStyle(document.querySelector("#editor")).caretColor===expected})()',
		),
		"The editor caret uses the brand color",
	)
	browser(session, "click", '[data-action="comments"]')
	wait(
		session,
		'Math.abs(document.querySelector("[data-inspector]").getBoundingClientRect().width - 352) < 1',
	)
	browser(session, "click", '[data-action="tools"]')
	wait(
		session,
		'Math.abs(document.querySelector("[data-inspector]").getBoundingClientRect().width - 224) < 1',
	)
	assert(
		true,
		"Comments use a wider sidebar and Tools restores the normal width",
	)
	browser(session, "fill", "#editor", "alpha alpha beta")
	browser(session, "press", "Control+f")
	browser(session, "fill", "#find-text", "alpha")
	wait(
		session,
		'document.querySelector(".find-count").textContent.includes("2")',
	)
	assert(
		evaluate(
			session,
			'getComputedStyle(document.querySelector("#find-bar")).position === "fixed" && document.querySelector(".find-replace-row").hidden',
		),
		"Find floats above the editor with replacement collapsed",
	)
	browser(session, "click", '[data-find-action="toggle-replace"]')
	browser(session, "fill", "#replace-text", "gamma")
	browser(session, "click", "#replace-one")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "gamma alpha beta"',
	)
	assert(
		true,
		"Replace finds the first match without requiring prior navigation",
	)
	browser(session, "click", "#replace-all")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "gamma gamma beta"',
	)
	browser(session, "screenshot", "/tmp/alkalye-find-parity.png")
	browser(session, "click", "#close-find")
	assert(
		evaluate(session, 'document.activeElement.id === "editor"'),
		"Closing Find restores editor focus",
	)
	browser(session, "press", "Control+f")
	assert(
		evaluate(
			session,
			'document.querySelector("#find-text").value === "alpha" && document.querySelector("#replace-text").value === "gamma" && document.querySelector("#find-next").disabled && document.querySelector("#find-previous").disabled',
		),
		"Find remembers search and replacement and disables empty navigation",
	)
	browser(session, "click", "#close-find")
	browser(session, "fill", "#editor", "alpha alpha alpha")
	evaluate(
		session,
		'(() => { let source = document.querySelector("alkalye-editor").source; source.focus(); source.setSelectionRange(0, 11); })()',
	)
	browser(session, "press", "Control+f")
	browser(session, "click", '[data-find-action="toggle-replace"]')
	browser(session, "fill", "#replace-text", "delta")
	browser(session, "check", "#find-selection-only")
	browser(session, "click", "#replace-all")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "delta delta alpha"',
	)
	assert(
		true,
		"Selection-only replacement leaves matches outside the opening selection intact",
	)
	browser(session, "click", "#close-find")

	browser(session, "fill", "#editor", "aaa")
	evaluate(
		session,
		'(() => { let source = document.querySelector("alkalye-editor").source; source.focus(); source.setSelectionRange(1, 3); })()',
	)
	browser(session, "press", "Control+f")
	browser(session, "fill", "#find-text", "aa")
	browser(session, "click", '[data-find-action="toggle-replace"]')
	browser(session, "fill", "#replace-text", "$&")
	browser(session, "check", "#find-selection-only")
	browser(session, "click", "#replace-all")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "a$&"',
	)
	assert(
		true,
		"Scoped literal replacement starts at the selection and preserves dollar characters",
	)
	browser(session, "click", "#close-find")
	browser(session, "fill", "#editor", "left cat right")
	evaluate(
		session,
		'(() => { let source = document.querySelector("alkalye-editor").source; source.focus(); source.setSelectionRange(5, 8); })()',
	)
	browser(session, "press", "Control+f")
	browser(session, "fill", "#find-text", "(?<=left )(c)(at)(?= right)")
	browser(session, "check", "#find-regex")
	browser(session, "click", '[data-find-action="toggle-replace"]')
	browser(session, "fill", "#replace-text", "$2$1")
	browser(session, "check", "#find-selection-only")
	browser(session, "click", "#replace-all")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "left atc right"',
	)
	assert(
		true,
		"Scoped regex replacement retains surrounding lookbehind and captures",
	)
	browser(session, "uncheck", "#find-regex")
	browser(session, "click", "#close-find")

	evaluate(
		session,
		'(() => { let host=document.querySelector("alkalye-editor"), source=host.source; source.focus(); source.setSelectionRange(0,5); document.querySelector("#editor").dispatchEvent(new MouseEvent("contextmenu", {bubbles:true,cancelable:true,clientX:500,clientY:150})); return true })()',
	)
	assert(
		evaluate(
			session,
			'[...document.querySelectorAll("body > [data-context-menu] > button")].every(button=>button.querySelector("svg"))',
		),
		"Editor context menus include icons",
	)
	browser(session, "press", "Escape")
	browser(
		session,
		"fill",
		"#editor",
		"ordinary line\n".repeat(300) + "distant needle",
	)
	evaluate(
		session,
		'(() => { let editor=document.querySelector("#editor"); editor.focus(); editor.setSelectionRange(0,0); editor.scrollTop=0; return true })()',
	)
	browser(session, "press", "Control+f")
	browser(session, "fill", "#find-text", "needle")
	browser(session, "click", "#find-next")
	wait(
		session,
		'document.querySelector("#editor").scrollTop > 100 && document.activeElement.id === "find-text"',
	)
	assert(true, "Find scrolls to distant matches while retaining search focus")
	browser(session, "click", "#close-find")
	browser(session, "set", "viewport", "504", "842")
	browser(session, "press", "Control+f")
	wait(session, 'Boolean(document.querySelector("#find-text"))')
	assert(
		evaluate(
			session,
			'document.querySelector("#find-bar").parentElement.id === "app" && getComputedStyle(document.querySelector("#find-bar")).filter === "none"',
		),
		"Mobile Find renders outside the blurred editor",
	)
	browser(session, "click", "#close-find")
	browser(session, "screenshot", "/tmp/alkalye-ui-leftovers.png")
	browser(session, "set", "viewport", "1440", "900")
	browser(session, "click", '[data-action="new-whiteboard"]')
	wait(session, 'Boolean(document.querySelector("alkalye-whiteboard")?.editor)')
	assert(
		evaluate(
			session,
			'getComputedStyle(document.querySelector("#dialog > form > header")).display === "none" && Math.abs(document.querySelector(".board-bar").getBoundingClientRect().height - 56) < 1',
		),
		"Whiteboard uses one compact header",
	)
	browser(session, "screenshot", "/tmp/alkalye-whiteboard-header.png")
	evaluate(
		session,
		'(() => { document.querySelector("alkalye-whiteboard").editor.createShapes([{type:"geo",x:0,y:0,props:{geo:"rectangle",w:100,h:80}}]); return true })()',
	)
	browser(session, "click", "#embed-board")
	wait(
		session,
		'!document.querySelector("#dialog").open && document.querySelector("alkalye-editor").source.value.includes("asset:")',
	)
	assert(
		true,
		"Embedding a drawing inserts its document reference and closes the board",
	)
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, 'Boolean(document.querySelector("alkalye-whiteboard")?.editor)')
	assert(
		evaluate(
			session,
			'document.querySelector("#embed-board").textContent.trim() === "Save"',
		),
		"An embedded drawing offers Save when reopened",
	)
	browser(session, "click", "#close-board")
	let board = String(
		evaluate(
			session,
			'document.querySelector("[data-attachments] [data-asset-id]").dataset.assetId',
		),
	)
	assert(
		evaluate(
			session,
			'![...document.querySelectorAll("#inspector-body h3")].some(heading=>heading.textContent.includes("Drawings"))',
		),
		"Whiteboards appear in the Assets list",
	)
	wait(
		session,
		'Boolean(document.querySelector("[data-attachments] .asset-thumbnail img"))',
	)
	browser(session, "click", `[data-action="asset-rename:${board}"]`)
	assert(
		evaluate(
			session,
			`getComputedStyle(document.querySelector('#dialog footer [value="cancel"]')).borderTopStyle === "solid"`,
		),
		"Cancel uses the original outline button",
	)
	browser(session, "fill", '#dialog input[name="value"]', "Renamed board")
	browser(session, "click", '#dialog footer [value="cancel"]')
	assert(
		evaluate(
			session,
			'document.querySelector("[data-attachments] .asset-row > button").textContent.includes("Whiteboard")',
		),
		"Cancel keeps the drawing name unchanged",
	)
	browser(session, "click", `[data-action="asset-rename:${board}"]`)
	browser(session, "fill", '#dialog input[name="value"]', "Renamed board")
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		'document.querySelector("[data-attachments] .asset-row > button").textContent.includes("Renamed board")',
	)
	assert(true, "Whiteboards can be renamed through the asset menu")
	evaluate(
		session,
		"window.assetDownload = undefined; HTMLAnchorElement.prototype.click = function(){ window.assetDownload=fetch(this.href).then(response=>response.json()).then(file=>({name:this.download,file})); }",
	)
	browser(session, "click", `[data-action="asset-download:${board}"]`)
	wait(session, "Boolean(window.assetDownload)")
	assert(
		evaluate(
			session,
			'window.assetDownload.then(result=>result.name === "Renamed board.tldr" && result.file.tldrawFileFormatVersion===1 && result.file.records.some(record=>record.typeName==="page"))',
		),
		"The asset menu downloads an editable tldraw file",
	)
	browser(session, "click", `[data-action="asset-delete:${board}"]`)
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		`!document.querySelector('[data-asset-id="${board}"]') && !document.querySelector("alkalye-editor").source.value.includes("asset:${board}")`,
	)
	evaluate(session, 'document.querySelector("#editor").focus()')
	browser(session, "press", "Control+z")
	wait(
		session,
		`Boolean(document.querySelector('[data-asset-id="${board}"]')) && document.querySelector("alkalye-editor").source.value.includes("asset:${board}")`,
	)
	assert(
		true,
		"Deleting and undoing a whiteboard restores its asset and source reference together",
	)
	browser(session, "click", '[data-action="share"]')
	wait(session, 'Boolean(document.querySelector("[data-access]"))')
	assert(
		evaluate(
			session,
			'document.querySelector("[data-access]").textContent.includes("Owner You") && !document.querySelector("[data-access] code") && !document.querySelector("[data-access] details").open',
		),
		"Sharing shows names and keeps technical identifiers collapsed",
	)
	browser(session, "click", "#dialog .dialog-close")
	console.log("UI leftovers browser checks passed")
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill()
	await server.exited
}
