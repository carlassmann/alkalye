import {
	assert,
	browser,
	evaluate,
	wait,
	currentDocument,
} from "./browser-driver"

export function verifyNativeThemes(session: string, original: string) {
	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		`${currentDocument} !== ${JSON.stringify(original)} && document.querySelector("#editor")?.value === ""`,
	)
	browser(
		session,
		"fill",
		"#editor",
		"---\ntheme: light\nsize: S\n---\n# Native theme\n\nPlatform styling.",
	)
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector(".theme")?.dataset.appearance === "light"',
	)
	assert(
		true,
		"native document rendering derives appearance directly from frontmatter",
	)
	browser(session, "click", ".preview-back")
	browser(session, "click", '[data-action="theme"]')
	wait(session, 'document.querySelector("#new-theme") !== null')
	let themedDocument = String(evaluate(session, currentDocument))
	browser(session, "click", "#new-theme")
	wait(
		session,
		'location.pathname.startsWith("/app/themes/") && document.querySelector("alkalye-theme-workbench alkalye-editor") !== null',
	)
	assert(
		evaluate(
			session,
			`(() => {
				let theme = location.pathname.split("/")[3];
				let source = document.querySelector("#main alkalye-editor").source.value;
				return location.pathname.endsWith("/workbench") &&
					new URLSearchParams(location.search).get("document") === ${JSON.stringify(themedDocument)} &&
					source.includes("theme-id:") && source.includes(theme) &&
					!document.querySelector("#dialog").open &&
					getComputedStyle(document.querySelector("alkalye-theme-workbench")).position === "fixed"
			})()`,
		),
		"native theme creation binds its source through frontmatter and opens the full-viewport workbench route",
	)
	browser(
		session,
		"fill",
		"alkalye-theme-workbench #editor",
		"# Platform theme\n\n```css theme\n.content { font-family: Georgia, serif; color: rgb(18, 52, 86); }\n```",
	)
	wait(
		session,
		'document.querySelector(".workbench-status").textContent === "Saved locally" && document.querySelector(".workbench-name").textContent === "Custom theme"',
	)
	evaluate(
		session,
		'window.oldThemeEditor = document.querySelector("alkalye-theme-workbench #editor")',
	)
	browser(session, "click", ".workbench-back")
	wait(
		session,
		`location.pathname === "/app/doc/${themedDocument}" && !window.oldThemeEditor.isConnected && document.querySelector("alkalye-theme-workbench") === null && !document.querySelector("#main").hasAttribute("inert")`,
	)
	assert(
		true,
		"leaving the native theme workbench returns to its document and releases the workbench",
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'getComputedStyle(document.querySelector("#preview").shadowRoot.querySelector(".content")).color === "rgb(18, 52, 86)"',
	)
	assert(
		true,
		"native preview compiles the theme record saved in its document stream",
	)
	browser(session, "click", ".preview-back")
	wait(session, "!!navigator.serviceWorker.controller")
	browser(session, "set", "offline", "on")
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#editor")?.value.includes("theme-id:")',
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'getComputedStyle(document.querySelector("#preview").shadowRoot.querySelector(".content")).color === "rgb(18, 52, 86)"',
	)
	assert(
		true,
		"native offline snapshots retain theme source and its frontmatter binding",
	)
	browser(session, "click", ".preview-back")
	let themed = String(evaluate(session, currentDocument))
	let previous = String(
		evaluate(
			session,
			'document.querySelector("#editor").value.match(/theme-id: ([^\\n]+)/)[1]',
		),
	)
	browser(session, "click", '[data-action="duplicate"]')
	wait(
		session,
		`${currentDocument} !== ${JSON.stringify(themed)} && document.querySelector("#editor")?.value.includes("theme-id:")`,
	)
	assert(
		evaluate(
			session,
			`!document.querySelector("#editor").value.includes(${JSON.stringify(previous)})`,
		),
		"theme copies bind to their own source identity",
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'getComputedStyle(document.querySelector("#preview").shadowRoot.querySelector(".content")).color === "rgb(18, 52, 86)"',
	)
	assert(true, "offline document copies preserve their custom theme")
	browser(session, "click", ".preview-back")
	browser(session, "set", "offline", "off")
	evaluate(session, 'window.dispatchEvent(new Event("focus"))')
	browser(session, "click", `[data-doc="${original}"]`)
	wait(session, `${currentDocument} === ${JSON.stringify(original)}`)
}
