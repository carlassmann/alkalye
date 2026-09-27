import JSZip from "jszip"
import { writeFileSync } from "node:fs"

let targets = new JSZip()
for (let index = 1; index <= 4; index++) {
	targets.file(
		`Sidebar ${index}.md`,
		`# Sidebar ${index}\n\n` +
			"Disposable benchmark paragraph.\n\n".repeat(index > 2 ? 8000 : 30),
	)
}
writeFileSync(
	"/tmp/sidebar-small.zip",
	await targets.generateAsync({ type: "uint8array" }),
)
let library = new JSZip()
for (let index = 1; index <= 200; index++) {
	library.file(
		`Library ${String(index).padStart(3, "0")}.md`,
		`# Library ${index}\n\n` + "Disposable library fixture.\n\n".repeat(120),
	)
}
writeFileSync(
	"/tmp/sidebar-library.zip",
	await library.generateAsync({ type: "uint8array" }),
)
