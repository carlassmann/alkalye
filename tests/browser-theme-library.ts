import { assert, browser, evaluate, visit, wait } from "./browser-driver"
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
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	browser(session, "set", "viewport", "1280", "900")
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	let plain = createDocument("---\ntitle: Plain essay\n---\n# Hello\n\nBody")
	verifyEmptyLibrary()
	let ids = verifyUploads()
	verifyDefaults(plain, ids)
	verifyWarnings()
	verifyPicker(ids)
	verifyWorkbench(ids)
	verifyDeletion(plain, ids)
	verifyReset(ids)
	verifyPersistence(ids)
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
		'document.querySelector("#dialog alkalye-theme-workbench #theme-source") !== null',
	)
	assert(
		evaluate(
			session,
			`(() => {
				let targets = [...document.querySelectorAll('#dialog alkalye-picker[name="theme-target"] [role=option]')].map(option => option.dataset.value);
				return targets.join() === "sample" &&
					document.querySelector("#theme-source").value.includes("rgb(1, 2, 3)") &&
					getComputedStyle(document.querySelector("#theme-preview").shadowRoot.querySelector(".content")).color === "rgb(1, 2, 3)"
			})()`,
		),
		"Editing a library theme opens the workbench on sample content",
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
		let editor = document.querySelector("#theme-source");
		editor.value += String.fromCharCode(10) + "Closing write regression";
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	})()`,
	)
	wait(session, 'typeof window.releaseThemeWrite === "function"')
	browser(session, "fill", "#theme-name", "Paper Two")
	evaluate(
		session,
		'document.querySelector("#theme-name").dispatchEvent(new Event("change", {bubbles: true}))',
	)
	// agent-browser's second Escape on a modal dialog leaves the page, so the
	// workbench closes with its button.
	browser(session, "click", "#dialog .dialog-close")
	wait(session, '!document.querySelector("#dialog").open')
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
		"Closing a workbench drains its queued rename behind a held write",
	)
	assert(
		evaluate(
			session,
			`document.querySelector('[data-theme-action="export"][data-theme="${ids.paper}"]').getAttribute("aria-label") === "Export Paper Two"`,
		),
		"Each theme offers an export of its Markdown source",
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
		'document.querySelector("#dialog alkalye-theme-workbench") !== null',
	)
	assert(
		text('document.querySelector("#theme-name").value') === "Custom theme 2",
		"A new custom theme is numbered and opens in the workbench",
	)
	// agent-browser's second Escape on a modal dialog leaves the page, so the
	// workbench closes with its button.
	browser(session, "click", "#dialog .dialog-close")
	wait(session, '!document.querySelector("#dialog").open')
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
