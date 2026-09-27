import { execFileSync } from "node:child_process"
import { Buffer } from "node:buffer"
import { setTimeout as sleep } from "node:timers/promises"
import console from "node:console"

function browser(...args) {
	return execFileSync(
		"agent-browser",
		["--session", "sidebar2", "--json", ...args],
		{ encoding: "utf8", timeout: 20000 },
	)
}
async function wait(source) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (evaluate(`Boolean(${source})`)) return
		await sleep(50)
	}
	throw Error("Condition timed out: " + source)
}
function evaluate(source) {
	return JSON.parse(
		execFileSync(
			"agent-browser",
			[
				"--session",
				"sidebar2",
				"--json",
				"eval",
				"-b",
				Buffer.from(source).toString("base64"),
			],
			{ encoding: "utf8" },
		),
	).data.result
}
let targets = evaluate(
	`Array.from(document.querySelectorAll('[data-doc-title]')).filter(e=>/^Sidebar [12]$/.test(e.dataset.docTitle)).map(e=>({title:e.dataset.docTitle,path:e.querySelector('a').getAttribute('href')}))`,
)
async function activate(title) {
	let target = targets.find(item => item.title === title)
	evaluate(`document.querySelector('a[href="${target.path}"]').click()`)
	await wait(
		`location.pathname===${JSON.stringify(target.path)} && document.querySelector('.cm-content')?.textContent.includes('# '+${JSON.stringify(title)})`,
	)
}
let first = targets.find(item => item.title === "Sidebar 1")
let second = targets.find(item => item.title === "Sidebar 2")
await activate(first.title)
let original = evaluate(
	`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`,
)
browser("focus", ".cm-content")
browser("press", "Control+Home")
evaluate(
	`(()=>{let editor=document.querySelector('.cm-content');editor.addEventListener('input',()=>{window.__saveInputAt=performance.now();setTimeout(()=>{window.__saveNavigationAt=performance.now();document.querySelector('a[href="${second.path}"]').click()},0)},{once:true})})()`,
)
browser("keyboard", "inserttext", "SAVEBOUNDARY")
await wait(
	`location.pathname===${JSON.stringify(second.path)} && document.querySelector('.cm-content')?.textContent.includes('# Sidebar 2')`,
)
if (
	evaluate(
		`document.querySelector('.cm-content').cmTile.view.state.doc.toString().includes('SAVEBOUNDARY')`,
	)
)
	throw Error("Edit leaked into destination")
let secondContent = evaluate(
	`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`,
)
browser("focus", ".cm-content")
browser("press", "Meta+z")
if (
	evaluate(
		`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`,
	) !== secondContent
)
	throw Error("History leaked between documents")
await sleep(600)
await activate(first.title)
await wait(
	`document.querySelector('.cm-content').cmTile.view.state.doc.toString().includes('SAVEBOUNDARY')`,
)
console.log(
	"Pending save persisted to correct document; destination history isolated. Navigation delay:",
	evaluate("window.__saveNavigationAt-window.__saveInputAt"),
)
browser("focus", ".cm-content")
browser("press", "Meta+a")
browser("keyboard", "inserttext", original)
await wait(
	`document.querySelector('.cm-content').cmTile.view.state.doc.toString()===${JSON.stringify(original)}`,
)
await sleep(600)
browser("fill", '[data-testid="doc-search-input"]', "Sidebar")
evaluate(
	`window.__retainedSidebar=document.querySelector('[data-testid="sidebar-document-list"]');true`,
)
await activate(second.title)
if (
	!evaluate(
		`window.__retainedSidebar.isConnected && document.querySelector('[data-testid="doc-search-input"]').value==='Sidebar'`,
	)
)
	throw Error("Sidebar/search remounted")
console.log("Sidebar node and search survive document switch")
browser("fill", '[data-testid="doc-search-input"]', "")
