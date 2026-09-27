import { evaluate } from "./browser.mjs"
import { setTimeout as sleep } from "node:timers/promises"
import console from "node:console"

for (let index = 1; index <= 4; index++) {
	evaluate(
		`document.querySelector('[data-doc-title="Sidebar ${index}"] a').click()`,
	)
	let expected =
		`---\ntitle: Sidebar ${index}\n---\n\n# Sidebar ${index}\n\n` +
		"Disposable benchmark paragraph.\n\n".repeat(index > 2 ? 8000 : 30)
	let content
	for (let attempt = 0; attempt < 100; attempt++) {
		content = evaluate(
			`document.querySelector('.cm-content')?.cmTile?.view.state.doc.toString()`,
		)
		if (content === expected) break
		await sleep(50)
	}
	if (content !== expected)
		throw Error(
			`Fixture ${index} differs: expected ${expected.length}, got ${content?.length}`,
		)
	console.log(
		`Sidebar ${index}: exact fixture restored (${content.length} characters)`,
	)
}
