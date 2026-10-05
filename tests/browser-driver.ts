import { spawnSync } from "node:child_process"
import { object } from "../src/shared/model"
export function browser(session: string, ...args: string[]) {
	if (args[0] === "click" && args[1]) {
		reveal(session, args[1])
		let target = browser(
			session,
			"eval",
			`(() => {document.querySelectorAll("[data-browser-target]").forEach(node=>node.removeAttribute("data-browser-target"));let target=[...document.querySelectorAll(${JSON.stringify(args[1])})].find(node=>node.checkVisibility() && !node.closest('#app:not(.library-open) [data-library], #app:not(.tools-open) [data-inspector]'));if(!target)throw new Error("No visible click target: "+JSON.stringify({selector:${JSON.stringify(args[1])},matches:document.querySelectorAll(${JSON.stringify(args[1])}).length,library:document.querySelector("#document-list")?.textContent,dialog:document.querySelector("#dialog")?.open}));target.dataset.browserTarget="";target.scrollIntoView({block:"center"});let scope=target.closest("[id]");if(scope){let id="#"+CSS.escape(scope.id);let stable=scope===target?id:id+" :is("+${JSON.stringify(args[1])}+")";if(document.querySelectorAll(stable).length===1)return stable}return "[data-browser-target]"})()`,
		)
		let selector = target.result
		if (typeof selector !== "string") throw new Error("Missing click selector")
		args[1] = selector
	}
	let result = spawnSync(
		"agent-browser",
		["--session", session, "--json", ...args],
		{
			encoding: "utf8",
			timeout: 35000,
			env: {
				...process.env,
				AGENT_BROWSER_HEADED: "false",
				AGENT_BROWSER_DEFAULT_TIMEOUT: "20000",
			},
		},
	)
	if (result.status !== 0)
		throw new Error(`${session} ${args[0]}: ${result.stderr || result.stdout}`)
	let parsed = object(JSON.parse(result.stdout))
	if (!parsed.success) throw new Error(JSON.stringify(parsed))
	return object(parsed.data)
}
// Sidebars start closed and some commands live in menus. Open whatever hides
// a click target by clicking its real toggle, as a person would.
function reveal(session: string, selector: string) {
	let steps = browser(
		session,
		"eval",
		`(() => { let matches = [...document.querySelectorAll(${JSON.stringify(selector)})]; if (!matches.length || matches.some(node => node.checkVisibility() && !node.closest('#app:not(.library-open) [data-library], #app:not(.tools-open) [data-inspector]'))) return "[]"; let node = matches.find(node => node.closest("alkalye-workspace-menu")) ?? matches[0], app = document.querySelector("#app"), steps = []; if (node.closest("[data-library]") && !app?.classList.contains("library-open")) steps.push(['[data-action="library"]', "[data-library] *"]); if (node.closest(".library-options")) steps.push(['[data-action="library-options"]', ".library-options"]); if (node.closest("[data-inspector]") && !app?.classList.contains("tools-open")) { if (app?.classList.contains("mode-preview")) steps.push(['.preview-back', '#editor']); steps.push(['[data-action="toggle-tools"]', "[data-inspector] *"]); } let popover = node.closest("[popover]:not(:popover-open)"); if (popover) { let scope = popover.closest('alkalye-workspace-menu, alkalye-picker'); steps.push([scope ? scope.localName + ' > .menu-trigger' : '[aria-controls="' + popover.id + '"]', scope ? scope.localName + ' > [popover]:popover-open' : '[id="' + popover.id + '"]:popover-open']); } let group = node.closest("details:not([open])"); if (group) steps.push(['details[data-group="' + group.dataset.group + '"] > summary', 'details[data-group="' + group.dataset.group + '"][open] > *']); return JSON.stringify(steps) })()`,
	).result
	for (let step of JSON.parse(typeof steps === "string" ? steps : "[]")) {
		if (!Array.isArray(step)) continue
		let [toggle, revealed] = step
		browser(
			session,
			"eval",
			`[...document.querySelectorAll(${JSON.stringify(toggle)})].find(node => node.checkVisibility())?.click()`,
		)
		try {
			browser(
				session,
				"wait",
				"--fn",
				`[...document.querySelectorAll(${JSON.stringify(revealed)})].some(node => node.checkVisibility())`,
			)
		} catch (error) {
			console.error({
				toggle,
				revealed,
				state: evaluate(
					session,
					'({app:document.querySelector("#app")?.className, workspace:document.querySelector("alkalye-workspace-menu")?.outerHTML, popovers:[...document.querySelectorAll(":popover-open")].map(node=>node.id), toast:document.querySelector("#toast")?.textContent})',
				),
			})
			throw error
		}
	}
}
// The open document's identifier from the path, written without quotes so it
// can sit inside any test expression.
export let currentDocument =
	"(location.pathname.match(/[/]doc[/]([^/]+)/) || [0, String()])[1]"
export let workspaceLabel =
	'document.querySelector("#workspace .menu-value").textContent.trim()'
export let workspaceValue =
	'document.querySelector("alkalye-workspace-menu").value'
// Chooses a workspace from the library's workspace menu by its label.
export function chooseWorkspace(session: string, label: string) {
	let value = evaluate(
		session,
		`[...document.querySelectorAll("alkalye-workspace-menu [role=menuitemradio]")].find(item => item.querySelector(":scope > span:not(.space-avatar)")?.textContent.trim() === ${JSON.stringify(label)})?.dataset.value`,
	)
	if (typeof value !== "string") throw new Error("No workspace " + label)
	browser(
		session,
		"click",
		`alkalye-workspace-menu [role=menuitemradio][data-value="${value}"]`,
	)
	wait(session, `${workspaceValue} === ${JSON.stringify(value)}`)
	return value
}
// Navigates within the app as a link would, without reloading.
export function visit(session: string, path: string) {
	evaluate(
		session,
		`history.pushState(null, "", ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent("popstate"))`,
	)
}
export function evaluate(session: string, source: string) {
	return browser(session, "eval", source).result
}
export function wait(session: string, source: string) {
	try {
		browser(session, "wait", "--fn", source)
	} catch (error) {
		console.error(
			session,
			evaluate(
				session,
				'({source:document.querySelector("alkalye-editor")?.source?.value,view:document.querySelector("#editor")?.value,status:document.querySelector("#save-status")?.textContent,retry:document.querySelector("#retry-save")?.hidden,toast:document.querySelector("#toast")?.textContent,results:window.documentApiResults?.slice(-8),failure:window.documentApiFailure,discussion:window.documentDiscussionStage,library:document.querySelector("#document-list")?.textContent,path:location.pathname+location.search,page:document.querySelector("[data-settings-page],[data-workspace-settings]")?.querySelector(".settings-content")?.id,appearance:document.documentElement.dataset.appearance,size:document.documentElement.style.getPropertyValue("--editor-size"),profile:document.querySelector(".profile-name")?.textContent.trim()})',
			),
		)
		throw error
	}
}
export function assert(condition: unknown, message: string) {
	if (!condition) throw new Error(message)
	console.log(`PASS ${message}`)
}

export function submitDialog(session: string, value?: string) {
	wait(
		session,
		'document.querySelector("#dialog").open && document.querySelector("#submit-dialog") !== null',
	)
	if (value !== undefined)
		browser(session, "fill", '#dialog [name="value"]', value)
	browser(session, "click", "#submit-dialog")
	wait(session, '!document.querySelector("#dialog").open')
}
