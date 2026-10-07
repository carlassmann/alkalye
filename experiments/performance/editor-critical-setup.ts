import { browser, evaluate } from "../../tests/browser-driver"

let url = Bun.argv[2],
	output = Bun.argv[3]
if (!url || !output) throw Error("Server URL and output required")
let session = "critical-current-" + Date.now()
let fixtures = [],
	failures = []
browser(session, "set", "viewport", "1280", "800")
browser(session, "open", url + "app")
browser(
	session,
	"wait",
	"--fn",
	"document.querySelector('alkalye-editor')?.source && !document.querySelector('alkalye-editor').source.readOnly",
)
for (let fixture of [
	{ name: "128k-512", characters: 128 * 1024, occurrences: 512 },
	{ name: "128k-2048", characters: 128 * 1024, occurrences: 2048 },
	{ name: "1m-512", characters: 1024 * 1024, occurrences: 512 },
	{ name: "1m-2048", characters: 1024 * 1024, occurrences: 2048 },
]) {
	try {
		browser(session, "click", '[data-action="new"]')
		browser(
			session,
			"wait",
			"--fn",
			"document.querySelector('alkalye-editor').source.value==='' && !document.querySelector('alkalye-editor').source.readOnly",
		)
		let unit = fixture.characters / fixture.occurrences
		evaluate(
			session,
			`(()=>{let source=document.querySelector('alkalye-editor').source;source.value=('TOKEN '+'z'.repeat(${unit}-7)+'\\n').repeat(${fixture.occurrences});source.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
		)
		browser(
			session,
			"wait",
			"--fn",
			`document.querySelector('alkalye-editor').source.value.length===${fixture.characters} && document.querySelector('#save-status')?.dataset.pending==='0' && document.querySelector('#save-status')?.getAttribute('aria-busy')==='false'`,
		)
		let path = evaluate(session, "location.pathname")
		fixtures.push({ ...fixture, path })
	} catch (error) {
		failures.push({ fixture: fixture.name, error: String(error) })
	}
	await Bun.write(
		output,
		JSON.stringify({ url, session, fixtures, failures }, null, 2),
	)
}
