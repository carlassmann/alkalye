import { assert, browser, evaluate, visit, wait } from "./browser-driver"
import { object } from "../src/shared/model"
import { encode } from "../src/shared/base64"
import { zip } from "../src/shared/zip"

// The original's account theme library in Settings → Editor → Themes:
// uploading Markdown and ZIP themes, defaults for previews and slideshows,
// missing-theme warnings, the workbench, export and deletion.

let paper = `# Paper

\`\`\`json theme metadata
{"name": "Paper", "type": "preview", "author": "Ada", "presets": [{"name": "Ink", "appearance": "light", "colors": {"background": "#fafafa", "foreground": "#111111", "accent": "#336699"}}]}
\`\`\`

\`\`\`css theme
.document .content { color: rgb(1, 2, 3); }
\`\`\`
`
let encoder = new TextEncoder()
let stage = encode(
	zip([
		{
			name: "stage/theme.json",
			data: encoder.encode(
				JSON.stringify({ name: "Stage", type: "slideshow", author: "Grace" }),
			),
		},
		{
			name: "stage/theme.css",
			data: encoder.encode(".slide .content { color: rgb(4, 5, 6); }"),
		},
	]),
)
	.replace(/-/g, "+")
	.replace(/_/g, "/")

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "theme-library-" + Date.now()
let url = ""
let plainPath = ""
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	browser(session, "set", "viewport", "1280", "900")
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	let plain = createDocument(
		"---\ntitle: Plain essay\nmode: present\n---\n# Hello\n\nBody",
	)
	plainPath = plain
	if (Bun.argv.includes("--undo")) {
		verifyScopedUndo()
	} else {
		verifyEmptyLibrary()
		let ids = verifyUploads()
		verifyDefaults(plain, ids)
		verifyWarnings()
		verifyPicker(ids)
		verifyWorkbench(ids)
		verifyDeletion(plain, ids)
		verifyReset(ids)
		verifyPersistence(ids)
		verifyWorkbenchBehavior(ids)
	}
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill("SIGTERM")
	await server.exited
}

function createDocument(source: string) {
	let previous = text("location.pathname")
	if (/\/(preview|slideshow|teleprompter)$/.test(previous)) {
		previous = previous.replace(/\/[a-z]+$/, "")
		visit(session, previous)
	} else if (!previous.startsWith("/app/doc/")) visit(session, "/app")
	wait(session, 'document.querySelector("[data-action=new]") !== null')
	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		`location.pathname !== ${JSON.stringify(previous)} && location.pathname.startsWith("/app/doc/") && !document.querySelector("#editor").readOnly`,
	)
	browser(session, "fill", "#editor", source)
	wait(
		session,
		'document.querySelector("#save-status")?.textContent === "Saved"',
	)
	return text("location.pathname")
}

function text(source: string) {
	let value = evaluate(session, source)
	if (typeof value !== "string") throw new Error("Expected text from " + source)
	return value
}

function openThemes() {
	visit(session, "/app/settings?category=editor")
	wait(
		session,
		'document.querySelector("#settings-editor alkalye-settings-themes .settings-actions") !== null',
	)
}

function upload(name: string, content: string, base64 = false) {
	evaluate(
		session,
		`(() => {
			let bytes = ${base64 ? `Uint8Array.from(atob(${JSON.stringify(content)}), char => char.charCodeAt(0))` : JSON.stringify(content)};
			let input = document.querySelector("[data-theme-file]");
			let files = new DataTransfer();
			files.items.add(new File([bytes], ${JSON.stringify(name)}));
			input.files = files.files;
			input.dispatchEvent(new Event("change", {bubbles: true}));
		})()`,
	)
}

function rows() {
	return text(
		'JSON.stringify([...document.querySelectorAll("[data-theme-row]")].map(row => [row.querySelector(".theme-name").textContent.trim(), row.querySelector(".theme-kind").textContent.replace(/\\s+/g, " ").trim()]))',
	)
}

function themeId(name: string) {
	return text(
		`[...document.querySelectorAll("[data-theme-row]")].find(row => row.querySelector(".theme-name").textContent.trim() === ${JSON.stringify(name)})?.dataset.themeRow ?? ""`,
	)
}

function verifyEmptyLibrary() {
	openThemes()
	assert(
		evaluate(
			session,
			`(() => {
				let section = document.querySelector("alkalye-settings-themes");
				return section.querySelector("h2").textContent === "Themes" &&
					section.querySelector(".section-description").textContent.trim() === "Custom styling for previews and slideshows." &&
					section.querySelector(".settings-empty strong").textContent === "No themes yet" &&
					section.querySelector(".settings-empty p").textContent.trim() === "Upload a theme file to customize the appearance" &&
					!section.textContent.includes("Default themes") &&
					section.querySelector("[data-theme-file]").accept === ".md,.theme.md,.zip"
			})()`,
		),
		"An account without themes sees the original's empty Themes section",
	)
}

function verifyUploads() {
	upload("paper.theme.md", paper)
	wait(session, 'document.querySelectorAll("[data-theme-row]").length === 1')
	assert(
		rows() === JSON.stringify([["Paper", "Preview • by Ada"]]) &&
			evaluate(
				session,
				"document.querySelector('alkalye-picker[name=\"previewTheme\"]') !== null && document.querySelector('alkalye-picker[name=\"slideshowTheme\"]') === null",
			),
		"An uploaded Markdown theme lists its name, kind and author with a preview default",
	)
	upload("broken.md", "```css theme\n.document { color: red; }\n")
	wait(session, 'document.querySelector(".theme-upload-error") !== null')
	assert(
		evaluate(
			session,
			'document.querySelector(".theme-upload-message").textContent.trim() === "This theme could not be read" && document.querySelector(".theme-upload-error li").textContent.includes("Unclosed css theme fence") && document.querySelectorAll("[data-theme-row]").length === 1',
		),
		"An invalid theme shows the upload error and adds nothing",
	)
	browser(session, "click", '[data-theme-action="dismiss"]')
	wait(session, 'document.querySelector(".theme-upload-error") === null')
	assert(true, "The upload error can be dismissed")
	upload("stage.zip", stage, true)
	wait(session, 'document.querySelectorAll("[data-theme-row]").length === 2')
	assert(
		rows() ===
			JSON.stringify([
				["Paper", "Preview • by Ada"],
				["Stage", "Slideshow • by Grace"],
			]) &&
			evaluate(
				session,
				"document.querySelector('alkalye-picker[name=\"slideshowTheme\"]') !== null",
			),
		"A ZIP theme imports as Markdown with its manifest's name, kind and author",
	)
	visit(session, "/app")
	browser(session, "click", '[data-action="library"]')
	wait(
		session,
		'document.querySelector("#document-list")?.textContent.includes("Plain essay")',
	)
	assert(
		!text('document.querySelector("#document-list").textContent').includes(
			"Themes",
		),
		"The library document holding the themes stays out of the document list",
	)
	openThemes()
	return { paper: themeId("Paper"), stage: themeId("Stage") }
}

function choose(name: string, value: string) {
	browser(session, "click", `alkalye-picker[name="${name}"] > .menu-trigger`)
	wait(
		session,
		`document.querySelector('alkalye-picker[name="${name}"] > [popover]:popover-open') !== null`,
	)
	browser(
		session,
		"click",
		`alkalye-picker[name="${name}"] [role=option][data-value="${value}"]`,
	)
}

function verifyDefaults(plain: string, ids: { paper: string; stage: string }) {
	choose("previewTheme", ids.paper)
	choose("slideshowTheme", ids.stage)
	wait(
		session,
		`document.querySelector('alkalye-picker[name="previewTheme"]').value === ${JSON.stringify(ids.paper)} && document.querySelector('alkalye-picker[name="slideshowTheme"]').value === ${JSON.stringify(ids.stage)}`,
	)
	visit(session, plain + "/preview")
	wait(
		session,
		'getComputedStyle(document.querySelector("#preview").shadowRoot.querySelector(".content")).color === "rgb(1, 2, 3)"',
	)
	assert(
		true,
		"A document without a theme previews in the default preview theme",
	)
	visit(session, plain + "/slideshow")
	wait(
		session,
		'getComputedStyle(document.querySelector("#slide").shadowRoot.querySelector(".content")).color === "rgb(4, 5, 6)"',
	)
	assert(true, "Its slideshow uses the default slideshow theme")
	visit(session, plain)
	wait(session, 'document.querySelector("#editor") !== null')
}

function verifyWarnings() {
	let missing = createDocument(
		"---\ntitle: Missing theme\ntheme: Nowhere\n---\n# Text",
	)
	visit(session, missing + "/preview")
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector(".theme-warning") !== null',
	)
	assert(
		text(
			'document.querySelector("#preview").shadowRoot.querySelector(".theme-warning").textContent',
		) === 'Theme "Nowhere" not found. Upload it in Settings > Themes.',
		"A theme named in frontmatter but missing from the library warns",
	)
	let preset = createDocument(
		"---\ntitle: Preset essay\ntheme: paper\npreset: Nope\n---\n# Text",
	)
	visit(session, preset + "/preview")
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector(".theme-warning") !== null',
	)
	assert(
		text(
			'document.querySelector("#preview").shadowRoot.querySelector(".theme-warning").textContent',
		) === 'Preset "Nope" not found in theme "Paper". Using "Ink" instead.' &&
			text(
				'getComputedStyle(document.querySelector("#preview").shadowRoot.querySelector(".content")).color',
			) === "rgb(1, 2, 3)",
		"A library theme is found by name regardless of case, and a missing preset warns",
	)
	let light = createDocument(
		"---\ntitle: Light essay\ntheme: light\n---\n# Text",
	)
	visit(session, light + "/preview")
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector(".theme")?.dataset.appearance === "light"',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#preview").shadowRoot.querySelector(".theme-warning") === null && getComputedStyle(document.querySelector("#preview").shadowRoot.querySelector(".content")).color === "rgb(1, 2, 3)"',
		),
		"An appearance-only theme keeps the default theme without a warning",
	)
	visit(session, light)
	wait(session, 'document.querySelector("#editor") !== null')
}

function verifyPicker(ids: { paper: string; stage: string }) {
	browser(session, "click", '[data-action="theme"]')
	wait(
		session,
		'document.querySelector("#dialog [data-theme-picker]") !== null',
	)
	assert(
		evaluate(
			session,
			`(() => {
				let values = [...document.querySelectorAll('#dialog alkalye-picker[name="theme"] [role=option]')].map(option => option.dataset.value);
				return values.includes(${JSON.stringify(ids.paper)}) && values.includes(${JSON.stringify(ids.stage)})
			})()`,
		),
		"The document theme dialog offers the account's library themes",
	)
	choose("theme", ids.paper)
	browser(session, "click", "#submit-dialog")
	wait(session, '!document.querySelector("#dialog").open')
	wait(
		session,
		`document.querySelector("alkalye-editor").source.value.includes('theme-id: "${ids.paper}"')`,
	)
	assert(
		true,
		"Choosing a library theme names it in the document's frontmatter",
	)
}

function verifyWorkbench(ids: { paper: string; stage: string }) {
	openThemes()
	browser(
		session,
		"click",
		`[data-theme-action="edit"][data-theme="${ids.paper}"]`,
	)
	wait(
		session,
		`location.pathname === "/app/themes/${ids.paper}/workbench" && document.querySelector("alkalye-theme-workbench alkalye-editor") !== null`,
	)
	assert(
		evaluate(
			session,
			`(() => {
				let targets = [...document.querySelectorAll('alkalye-theme-workbench alkalye-picker[name="theme-target"] [role=option]')].map(option => option.textContent.trim());
				return targets[0] === "Sample content" && targets.includes("Plain essay") && !targets.includes("Themes") &&
					document.querySelector('alkalye-picker[name="theme-target"]').value === "sample" &&
					document.querySelector("alkalye-theme-workbench alkalye-editor").source.value.includes("rgb(1, 2, 3)") &&
					getComputedStyle(document.querySelector("#theme-preview").shadowRoot.querySelector(".content")).color === "rgb(1, 2, 3)"
			})()`,
		),
		"Editing a library theme opens its workbench route on sample content with the account's documents as targets",
	)
	evaluate(
		session,
		`(() => {
		let transaction = IDBDatabase.prototype.transaction;
		let held = false;
		window.restoreThemeTransactions = () => { IDBDatabase.prototype.transaction = transaction; };
		IDBDatabase.prototype.transaction = function(names, mode, options) {
			let tx = transaction.call(this, names, mode, options);
			if (this.name.startsWith("alkalye-document-v1:") && mode === "readwrite" && !held) {
				held = true;
				tx.addEventListener("complete", event => {
					event.stopImmediatePropagation();
					window.releaseThemeWrite = () => tx.oncomplete?.call(tx, new Event("complete"));
				});
			}
			return tx;
		};
		let source = document.querySelector("alkalye-theme-workbench alkalye-editor").source;
		let start = source.value.indexOf('"name": "Paper"') + 9;
		source.setRangeText("Paper Two", start, start + 5);
		document.querySelector("alkalye-theme-workbench #editor").dispatchEvent(new Event("input", { bubbles: true }));
	})()`,
	)
	wait(session, 'typeof window.releaseThemeWrite === "function"')
	assert(
		text('document.querySelector(".workbench-name").textContent') ===
			"Paper Two",
		"The workbench header names the theme from its source metadata",
	)
	browser(session, "click", ".workbench-back")
	wait(
		session,
		'location.pathname === "/app/settings" && document.querySelector("alkalye-theme-workbench") === null',
	)
	browser(session, "wait", "100")
	evaluate(
		session,
		"window.restoreThemeTransactions(); window.releaseThemeWrite(); delete window.restoreThemeTransactions; delete window.releaseThemeWrite",
	)
	wait(
		session,
		'[...document.querySelectorAll("[data-theme-row] .theme-name")].some(name => name.textContent.trim() === "Paper Two")',
	)
	assert(
		true,
		"Leaving a workbench drains its queued source edit behind a held write",
	)
	assert(
		evaluate(
			session,
			`document.querySelector('[data-theme-action="export"][data-theme="${ids.paper}"]').getAttribute("aria-label") === "Export Paper Two"`,
		),
		"Each theme offers an export of its Markdown source",
	)
}

// The original workbench's controls, at desktop and phone widths.
function verifyWorkbenchBehavior(ids: { paper: string; stage: string }) {
	browser(session, "set", "viewport", "1280", "900")
	visit(session, `/app/themes/${ids.paper}/workbench`)
	wait(
		session,
		'document.querySelector("alkalye-theme-workbench alkalye-editor") !== null',
	)
	browser(session, "reload")
	wait(
		session,
		'document.querySelector(".workbench-name")?.textContent === "Paper Two"',
	)
	assert(
		evaluate(
			session,
			`(() => {
				let header = document.querySelector(".workbench-header");
				let labels = [...header.querySelectorAll("button, a")].map(control => control.getAttribute("aria-label") ?? control.textContent.trim());
				return header.getBoundingClientRect().height === 48 &&
					header.querySelector(".workbench-title p").textContent === "Theme workbench" &&
					header.querySelector(".workbench-back").getAttribute("href") === "/app/settings?category=editor" &&
					labels.join() === "Back to settings,New from default,Open source" &&
					document.querySelector(".workbench-status").textContent === "Saved locally"
			})()`,
		),
		"A reloaded workbench route shows the original header and saved-locally source pane",
	)
	evaluate(
		session,
		"document.querySelector('[aria-label=\"Dark preview\"]').click(); document.querySelector('[aria-label=\"Slideshow preview\"]').click(); document.activeElement.blur()",
	)
	wait(
		session,
		'document.querySelector(".workbench-preview").dataset.appearance === "dark" && document.querySelector("#theme-preview").shadowRoot.querySelector(".theme.slide") !== null',
	)
	browser(session, "press", "ArrowRight")
	wait(
		session,
		'document.querySelector("#theme-preview").shadowRoot.textContent.includes("A second slide")',
	)
	assert(
		evaluate(
			session,
			'document.querySelector(\'[aria-label="Slideshow preview"]\').getAttribute("aria-pressed") === "true" && document.querySelector(\'[aria-label="Document preview"]\').getAttribute("aria-pressed") === "false" && document.querySelector(\'[aria-label="Dark preview"]\').getAttribute("aria-pressed") === "true" && document.querySelector(\'[data-workbench-action="next-slide"]\').disabled',
		),
		"Icon buttons switch to a dark slideshow preview whose slides advance with the keyboard",
	)
	browser(session, "press", "f")
	wait(session, "document.fullscreenElement === document.documentElement")
	assert(true, "Workbench fullscreen keeps both source and preview visible")
	browser(session, "press", "f")
	wait(session, "document.fullscreenElement === null")
	browser(session, "click", 'alkalye-picker[name="theme-target"] > button')
	browser(session, "press", "ArrowLeft")
	assert(
		evaluate(
			session,
			'document.querySelector("#theme-preview").shadowRoot.textContent.includes("A second slide")',
		),
		"Picker keyboard navigation does not move the workbench slideshow",
	)
	browser(session, "press", "Escape")
	evaluate(
		session,
		"document.querySelector('[aria-label=\"Document preview\"]').click(); document.querySelector('[aria-label=\"Light preview\"]').click()",
	)
	choose("theme-target", plainDocument())
	wait(
		session,
		'document.querySelector("#theme-preview").shadowRoot.textContent.includes("Hello") && getComputedStyle(document.querySelector("#theme-preview").shadowRoot.querySelector(".content")).color === "rgb(1, 2, 3)"',
	)
	assert(true, "Choosing a document previews its content with the theme")
	evaluate(
		session,
		`(() => {
			let source = document.querySelector("alkalye-theme-workbench alkalye-editor").source;
			source.setRangeText("\\n\`\`\`css theme\\n.broken {", source.value.length, source.value.length);
			document.querySelector("alkalye-theme-workbench #editor").dispatchEvent(new Event("input", { bubbles: true }));
		})()`,
	)
	wait(session, '!document.querySelector(".workbench-errors").hidden')
	let line = Number(
		evaluate(
			session,
			'document.querySelector("alkalye-theme-workbench alkalye-editor").source.value.split("\\n").length - 1',
		),
	)
	assert(
		text(
			'document.querySelector(".workbench-errors button").textContent.replace(/\\s+/g, " ").trim()',
		) ===
			`Line ${line}: Unclosed css theme fence. Preview keeps the last valid theme.` &&
			text(
				'getComputedStyle(document.querySelector("#theme-preview").shadowRoot.querySelector(".content")).color',
			) === "rgb(1, 2, 3)",
		"An invalid source names its line while the preview keeps the last valid theme",
	)
	wait(
		session,
		'document.querySelector(".workbench-status").textContent === "Saved locally"',
	)
	browser(session, "reload")
	wait(
		session,
		'!document.querySelector(".workbench-errors")?.hidden && document.querySelector("#theme-preview")?.shadowRoot?.querySelector(".content")',
	)
	assert(
		text(
			'getComputedStyle(document.querySelector("#theme-preview").shadowRoot.querySelector(".content")).color',
		) === "rgb(1, 2, 3)",
		"An invalid saved source retains its last valid preview after reload",
	)
	browser(session, "click", ".workbench-errors button")
	assert(
		evaluate(
			session,
			'(() => { let source = document.querySelector("alkalye-theme-workbench alkalye-editor").source; return source.value.slice(source.selectionStart, source.selectionEnd) === "```css theme" && document.activeElement === document.querySelector("alkalye-theme-workbench #editor") })()',
		),
		"Choosing a validation error selects its source line",
	)
	evaluate(
		session,
		`(() => {
			let source = document.querySelector("alkalye-theme-workbench alkalye-editor").source;
			source.setRangeText("", source.value.lastIndexOf("\\n\`\`\`css theme"), source.value.length);
			document.querySelector("alkalye-theme-workbench #editor").dispatchEvent(new Event("input", { bubbles: true }));
		})()`,
	)
	wait(session, 'document.querySelector(".workbench-errors").hidden')
	verifyPanes("vertical", "ArrowLeft", 45)
	browser(session, "set", "viewport", "390", "844")
	wait(
		session,
		'document.querySelector(".workbench-panes").dataset.orientation === "column"',
	)
	verifyPanes("horizontal", "ArrowUp", 45)
	browser(session, "set", "viewport", "1280", "900")
	browser(session, "click", '[data-workbench-action="new-default"]')
	wait(
		session,
		`location.pathname.startsWith("/app/themes/") && !location.pathname.includes(${JSON.stringify(ids.paper)}) && document.querySelector(".workbench-name")?.textContent === "Custom theme 3"`,
	)
	assert(
		evaluate(
			session,
			'document.querySelector(".workbench-errors").hidden && document.querySelector("alkalye-theme-workbench alkalye-editor").source.value.includes(":scope[data-appearance=\\"dark\\"]")',
		),
		"New from default creates a valid library theme and opens its workbench",
	)
	if (Bun.argv.includes("--screenshots")) {
		browser(session, "screenshot", "/tmp/alkalye-rewrite-workbench.png")
		browser(session, "set", "viewport", "504", "842")
		browser(session, "screenshot", "/tmp/alkalye-rewrite-workbench-mobile.png")
		browser(session, "set", "viewport", "1280", "900")
	}
	browser(session, "click", '[data-workbench-link="source"]')
	wait(
		session,
		'location.pathname.endsWith("/source") && document.querySelector("alkalye-theme-workbench")?.dataset.view === "source" && document.querySelector("alkalye-theme-workbench alkalye-editor") !== null',
	)
	let sourcePath = text("location.pathname")
	browser(session, "reload")
	wait(
		session,
		`location.pathname === ${JSON.stringify(sourcePath)} && document.querySelector(".workbench-name")?.textContent === "Custom theme 3"`,
	)
	assert(
		evaluate(
			session,
			`(() => {
				let host = document.querySelector("alkalye-theme-workbench");
				let visible = selector => [...host.querySelectorAll(selector)].some(node => node.checkVisibility());
				return host.dataset.view === "source" &&
					host.querySelector(".workbench-title p").textContent === "Theme source" &&
					!visible('[data-pane="preview"]') && !visible("[data-restore]") && !visible('[role="separator"]') &&
					!visible("[data-layout-controls] button") && !visible('[data-workbench-action="new-default"]') &&
					host.querySelector('[data-workbench-link="workbench"]').getAttribute("href") === location.pathname.replace(/source$/, "workbench") &&
					host.querySelector("alkalye-theme-workbench alkalye-editor, alkalye-editor").source.value.includes("Custom theme 3")
			})()`,
		),
		"Open source navigates to a reloadable full source view with an Open workbench link",
	)
	browser(session, "back")
	wait(
		session,
		'location.pathname.endsWith("/workbench") && document.querySelector("alkalye-theme-workbench")?.dataset.view === "workbench" && document.querySelector(".workbench-name")?.textContent === "Custom theme 3"',
	)
	browser(session, "click", '[data-workbench-link="source"]')
	wait(session, 'location.pathname.endsWith("/source")')
	browser(session, "click", '[data-workbench-link="workbench"]')
	wait(
		session,
		`location.pathname.endsWith("/workbench") && document.querySelector('[data-pane="preview"]')?.checkVisibility()`,
	)
	assert(true, "Back and Open workbench return from the source view")
	verifySourceFind()
	verifyDeletionWhileOpen()
	browser(session, "back")
	browser(session, "back")
	browser(session, "back")
	wait(
		session,
		'document.querySelector(".workbench-name")?.textContent === "Paper Two"',
	)
	assert(true, "Back returns to the previous theme's workbench")
	verifyStaleTargets()
	verifyScopedUndo()
	visit(session, "/app/themes/missing-theme/workbench")
	wait(
		session,
		'document.querySelector("alkalye-theme-workbench h1")?.textContent === "Theme unavailable"',
	)
	assert(true, "An unknown theme shows the original unavailable state")
}

// Ctrl/Cmd+F searches the theme source, not the document underneath.
function verifySourceFind() {
	evaluate(session, "document.activeElement?.blur()")
	browser(session, "press", modifier() + "+f")
	wait(
		session,
		'document.querySelector("[data-workbench-find] alkalye-find #find-text") === document.activeElement',
	)
	browser(
		session,
		"fill",
		"alkalye-theme-workbench #find-text",
		"--theme-accent",
	)
	browser(session, "press", "Enter")
	assert(
		evaluate(
			session,
			`(() => {
				let source = document.querySelector("alkalye-theme-workbench alkalye-editor").source;
				return source.value.slice(source.selectionStart, source.selectionEnd) === "--theme-accent" &&
					document.querySelector("#find-bar").hidden &&
					document.querySelector("#main alkalye-find") === null
			})()`,
		),
		"Find opens in the source pane and selects matches in the theme source only",
	)
	browser(session, "press", "Escape")
	wait(session, 'document.querySelector("[data-workbench-find]").hidden')
}

// Another tab deletes the theme while it is open here.
function verifyDeletionWhileOpen() {
	let name = text('document.querySelector(".workbench-name").textContent')
	let path = text("location.pathname")
	let original = activeTab()
	browser(session, "tab", "new")
	browser(session, "open", new URL("/app/settings?category=editor", url).href)
	wait(
		session,
		`[...document.querySelectorAll("[data-theme-row] .theme-name")].some(row => row.textContent.trim() === ${JSON.stringify(name)})`,
	)
	let id = path.split("/")[3] ?? ""
	browser(session, "click", `[data-theme-action="delete"][data-theme="${id}"]`)
	browser(session, "click", "#submit-dialog")
	wait(session, `document.querySelector('[data-theme-row="${id}"]') === null`)
	browser(session, "tab", original)
	wait(
		session,
		'document.querySelector("alkalye-theme-workbench")?.dataset.state === "unavailable"',
	)
	evaluate(
		session,
		'window.workbenchErrors = []; addEventListener("error", event => window.workbenchErrors.push(String(event.message)))',
	)
	browser(session, "press", "ArrowRight")
	wait(
		session,
		`(() => {
			let host = document.querySelector("alkalye-theme-workbench");
			return host.querySelector(".workbench-unavailable").checkVisibility() &&
				!host.querySelector(".workbench-panes").checkVisibility() &&
				host.querySelector(".workbench-header").checkVisibility() &&
				host.querySelector("#editor").readOnly &&
				host.querySelector(".workbench-status").textContent === "Read-only" &&
				window.workbenchErrors.length === 0
		})()`,
	)
	assert(
		true,
		"A theme deleted while open turns its workbench read-only and unavailable without errors",
	)
}

// Choosing a document and then sample content before it opens keeps sample
// content.
function verifyStaleTargets() {
	let plain = plainDocument()
	evaluate(
		session,
		`(() => {
			let picker = document.querySelector('alkalye-picker[name="theme-target"]');
			picker.value = ${JSON.stringify(plain)};
			picker.dispatchEvent(new Event("change", { bubbles: true }));
			picker.value = "sample";
			picker.dispatchEvent(new Event("change", { bubbles: true }));
		})()`,
	)
	browser(session, "wait", "1500")
	assert(
		evaluate(
			session,
			'(() => { let text = document.querySelector("#theme-preview").shadowRoot.textContent; return text.includes("Use this sample to tune type") && !text.includes("Hello") && document.querySelector(".workbench-preview-message").hidden })()',
		),
		"A preview target that finishes opening after another was chosen is ignored",
	)
}

// Undo in a theme's source undoes the theme only, never the document text
// that shares its session.
function verifyScopedUndo() {
	visit(session, new URL(plainPath, url).pathname)
	wait(
		session,
		'document.querySelector("#main alkalye-editor")?.source && !document.querySelector("#editor").readOnly',
	)
	evaluate(
		session,
		`(() => {
			let source = document.querySelector("#main alkalye-editor").source;
			source.setRangeText("\\nBody typed before the theme", source.value.length, source.value.length);
			document.querySelector("#main #editor").dispatchEvent(new Event("input", { bubbles: true }));
		})()`,
	)
	wait(
		session,
		'document.querySelector("#save-status")?.textContent === "Saved"',
	)
	browser(session, "click", '[data-action="theme"]')
	wait(session, 'document.querySelector("#new-theme") !== null')
	browser(session, "click", "#new-theme")
	wait(
		session,
		'location.pathname.endsWith("/workbench") && new URLSearchParams(location.search).has("document") && document.querySelector("alkalye-theme-workbench alkalye-editor") !== null',
	)
	if (Bun.argv.includes("--screenshots")) {
		wait(
			session,
			'document.querySelector("#theme-preview").shadowRoot.querySelector(".content") !== null',
		)
		assert(
			text(
				'getComputedStyle(document.querySelector("#theme-preview").shadowRoot.querySelector(".content")).fontSize',
			) === "16px",
			"Preview typography matches the original at 16px",
		)
		browser(session, "screenshot", "/tmp/alkalye-rewrite-workbench.png")
		browser(session, "set", "viewport", "504", "842")
		browser(session, "screenshot", "/tmp/alkalye-rewrite-workbench-mobile.png")
		browser(session, "set", "viewport", "1280", "900")
	}
	let before = text(
		'document.querySelector("alkalye-theme-workbench alkalye-editor").source.value',
	)
	evaluate(
		session,
		'document.querySelector("alkalye-theme-workbench #editor").focus()',
	)
	browser(session, "keyboard", "type", "Theme typing")
	wait(
		session,
		'document.querySelector("alkalye-theme-workbench alkalye-editor").source.value.includes("Theme typing") && document.querySelector(".workbench-status").textContent === "Saved locally"',
	)
	let themeSource =
		'document.querySelector("alkalye-theme-workbench alkalye-editor").source.value'
	for (let step = 0; step < 20 && text(themeSource) !== before; step++) {
		browser(session, "press", "Control+z")
		browser(session, "wait", "200")
	}
	browser(session, "press", "Control+z")
	browser(session, "press", "Control+z")
	browser(session, "wait", "500")
	assert(
		evaluate(
			session,
			`document.querySelector("alkalye-theme-workbench alkalye-editor").source.value === ${JSON.stringify(before)} && document.querySelector("#main alkalye-editor").source.value.includes("Body typed before the theme")`,
		),
		"Undo in an attached theme's source leaves the document's own text intact",
	)
	browser(session, "click", ".workbench-back")
	wait(
		session,
		'document.querySelector("alkalye-theme-workbench") === null && document.querySelector("#main alkalye-editor").source.value.includes("Body typed before the theme")',
	)
	assert(true, "The document keeps its text after leaving the theme source")
}

// Resizing, collapsing and restoring the panes at one orientation.
function verifyPanes(orientation: string, smaller: string, expected: number) {
	evaluate(session, "document.querySelector('[role=\"separator\"]').focus()")
	browser(session, "press", "End")
	browser(session, "press", smaller)
	browser(session, "press", smaller)
	browser(session, "press", smaller)
	browser(session, "press", smaller)
	browser(session, "press", smaller)
	browser(session, "press", smaller)
	assert(
		evaluate(
			session,
			`(() => {
				let separator = document.querySelector('[role="separator"]');
				let source = document.querySelector('[data-pane="source"]').getBoundingClientRect();
				let panes = document.querySelector(".workbench-panes").getBoundingClientRect();
				let share = ${JSON.stringify(orientation)} === "vertical" ? source.width / (panes.width - 8) : source.height / (panes.height - 8);
				return separator.getAttribute("aria-orientation") === ${JSON.stringify(orientation)} &&
					separator.getAttribute("aria-valuenow") === "${expected}" &&
					separator.getAttribute("aria-valuetext") === "Source pane ${expected}%" &&
					Math.abs(share - ${expected / 100}) < 0.02
			})()`,
		),
		`The ${orientation} divider resizes the panes from the keyboard within 25-75%`,
	)
	browser(session, "press", "Home")
	assert(
		text(
			'document.querySelector(\'[role="separator"]\').getAttribute("aria-valuenow")',
		) === "25",
		`Home moves the ${orientation} divider to its minimum`,
	)
	browser(session, "click", '[aria-label="Maximize preview"]')
	assert(
		evaluate(
			session,
			"document.querySelector('[data-pane=\"source\"]').hidden && !document.querySelector('[data-restore=\"source\"]').hidden && document.querySelector('[role=\"separator\"]').hidden",
		),
		`Maximizing the ${orientation} preview leaves a source restore strip`,
	)
	browser(session, "click", '[aria-label="Restore source pane"]')
	browser(session, "click", '[aria-label="Minimize preview"]')
	assert(
		evaluate(
			session,
			"document.querySelector('[data-pane=\"preview\"]').hidden && !document.querySelector('[data-restore=\"preview\"]').hidden && document.querySelector('[aria-label=\"Restore split view\"]') !== null",
		),
		`Minimizing the ${orientation} preview leaves a preview restore strip`,
	)
	browser(session, "click", '[aria-label="Restore split view"]')
	wait(
		session,
		'document.querySelector(".workbench-panes").dataset.layout === "split"',
	)
}

function activeTab() {
	let tabs = browser(session, "tab", "list").tabs
	let active = Array.isArray(tabs)
		? tabs.find(tab => object(tab).active === true)
		: undefined
	let id = active ? object(active).tabId : undefined
	if (typeof id !== "string") throw new Error("No active tab")
	return id
}

function modifier() {
	return evaluate(session, "/Mac/i.test(navigator.platform)")
		? "Meta"
		: "Control"
}

function plainDocument() {
	return text(
		'[...document.querySelectorAll(\'alkalye-picker[name="theme-target"] [role=option]\')].find(option => option.textContent.trim() === "Plain essay")?.dataset.value ?? ""',
	)
}

function verifyDeletion(plain: string, ids: { paper: string; stage: string }) {
	browser(
		session,
		"click",
		`[data-theme-action="delete"][data-theme="${ids.stage}"]`,
	)
	wait(session, 'document.querySelector("#dialog").open')
	assert(
		evaluate(
			session,
			'document.querySelector("#dialog-title").textContent === "Delete theme" && document.querySelector("#dialog").textContent.includes(\'Are you sure you want to delete "Stage"? Documents using this theme will fall back to default styles.\')',
		),
		"Deleting asks with the original's confirmation",
	)
	browser(session, "click", "#submit-dialog")
	wait(session, 'document.querySelectorAll("[data-theme-row]").length === 1')
	wait(
		session,
		"document.querySelector('alkalye-picker[name=\"slideshowTheme\"]') === null",
	)
	visit(session, plain + "/slideshow")
	wait(
		session,
		'getComputedStyle(document.querySelector("#slide").shadowRoot.querySelector(".content")).color !== "rgb(4, 5, 6)"',
	)
	assert(true, "A deleted default slideshow theme no longer styles slideshows")
	visit(session, plain)
	wait(session, 'document.querySelector("#editor") !== null')
}

function verifyReset(ids: { paper: string; stage: string }) {
	openThemes()
	browser(session, "click", '[data-preference-action="reset"]')
	wait(session, 'document.querySelector("#setting-lineWidth")?.value === "65"')
	assert(
		text(
			"document.querySelector('alkalye-picker[name=\"previewTheme\"]').value",
		) === ids.paper,
		"Resetting editor settings keeps the default themes",
	)
	browser(session, "click", '[data-theme-action="new"]')
	wait(
		session,
		'location.pathname.startsWith("/app/themes/") && document.querySelector(".workbench-name")?.textContent === "Custom theme 2"',
	)
	assert(true, "A new custom theme is numbered and opens in the workbench")
	browser(session, "click", ".workbench-back")
	wait(session, 'document.querySelectorAll("[data-theme-row]").length === 2')
}

function verifyPersistence(ids: { paper: string; stage: string }) {
	browser(session, "reload")
	wait(
		session,
		'document.querySelectorAll("alkalye-settings-themes [data-theme-row]").length === 2',
	)
	assert(
		rows() ===
			JSON.stringify([
				["Paper Two", "Preview • by Ada"],
				["Custom theme 2", "Preview & Slideshow"],
			]) &&
			text(
				"document.querySelector('alkalye-picker[name=\"previewTheme\"]').value",
			) === ids.paper,
		"The theme library and its defaults survive a reload",
	)
}
