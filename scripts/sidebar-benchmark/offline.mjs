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
let path = evaluate("location.pathname")
let original = evaluate(
	`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`,
)
if (!evaluate("Boolean(navigator.serviceWorker.controller)"))
	throw Error("Service worker must control offline test")
try {
	browser("set", "offline", "on")
	browser("reload")
	await wait(
		`location.pathname===${JSON.stringify(path)} && document.querySelector('.cm-content')?.cmTile?.view.state.doc.toString()===${JSON.stringify(original)}`,
	)
	await wait(
		`(()=>{let editor=document.querySelector('.cm-content');let r=editor.getBoundingClientRect();return editor.contains(document.elementFromPoint(r.left+25,r.top+12))})()`,
	)
	browser("focus", ".cm-content")
	browser("keyboard", "inserttext", "OFFLINE_MARKER")
	await wait(
		`document.querySelector('.cm-content').textContent.includes('OFFLINE_MARKER')`,
	)
	await sleep(600)
	browser("reload")
	await wait(
		`document.querySelector('.cm-content')?.textContent.includes('OFFLINE_MARKER')`,
	)
	browser("focus", ".cm-content")
	browser("press", "Meta+a")
	browser("keyboard", "inserttext", original)
	await wait(
		`document.querySelector('.cm-content').cmTile.view.state.doc.toString()===${JSON.stringify(original)}`,
	)
	await sleep(600)
	evaluate(`document.querySelector('[data-doc-title="Sidebar 1"] a').click()`)
	await wait(
		`document.querySelector('.cm-content')?.textContent.includes('# Sidebar 1')`,
	)
	evaluate(`document.querySelector('a[href="${path}"]').click()`)
	await wait(
		`location.pathname===${JSON.stringify(path)} && document.querySelector('.cm-content')?.cmTile?.view.state.doc.toString()===${JSON.stringify(original)}`,
	)
	console.log(
		"Offline reload, typing persistence, fixture restoration and cached document switching passed",
	)
} finally {
	browser("set", "offline", "off")
}
