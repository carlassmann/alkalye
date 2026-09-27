import { browser, evaluate, wait } from "./browser.mjs"
import { setTimeout as sleep } from "node:timers/promises"
import console from "node:console"

await wait(`document.querySelector('[data-testid="doc-search-input"]')`)
browser("fill", '[data-testid="doc-search-input"]', "")
await wait(`document.querySelector('[data-doc-title="Sidebar 2"] a')`)
let targets = evaluate(
	`Array.from(document.querySelectorAll('[data-doc-title]')).filter(e=>/^Sidebar [12]$/.test(e.dataset.docTitle)).map(e=>({title:e.dataset.docTitle,path:new URL(e.querySelector('a').href).pathname}))`,
)
async function activate(title) {
	let target = targets.find(item => item.title === title)
	let link = `Array.from(document.querySelectorAll('[data-doc-title] a')).find(link => new URL(link.href).pathname === ${JSON.stringify(target.path)})`
	await wait(link)
	evaluate(`(${link}).click()`)
	await wait(
		`location.pathname===${JSON.stringify(target.path)} && document.querySelector('.cm-content')?.textContent.includes('# '+${JSON.stringify(title)})`,
	)
}
if (targets.length !== 2)
	throw Error("Import Sidebar 1 and Sidebar 2 into the active library")
let first = targets.find(item => item.title === "Sidebar 1")
let second = targets.find(item => item.title === "Sidebar 2")
await activate(first.title)
let original = evaluate(
	`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`,
)
try {
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
	browser("keyboard", "inserttext", "DESTINATION_UNDO")
	await wait(
		`document.querySelector('.cm-content').textContent.includes('DESTINATION_UNDO')`,
	)
	browser("press", "Meta+z")
	await wait(
		`document.querySelector('.cm-content').cmTile.view.state.doc.toString()===${JSON.stringify(secondContent)}`,
	)
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
	await restoreOriginal()
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
} finally {
	await restoreOriginal()
}

async function restoreOriginal() {
	browser("fill", '[data-testid="doc-search-input"]', "")
	await activate(first.title)
	if (
		evaluate(
			`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`,
		) === original
	)
		return
	browser("focus", ".cm-content")
	browser("press", "Meta+a")
	browser("keyboard", "inserttext", original)
	await wait(
		`document.querySelector('.cm-content').cmTile.view.state.doc.toString()===${JSON.stringify(original)}`,
	)
	await sleep(600)
}
