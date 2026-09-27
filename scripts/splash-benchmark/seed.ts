import { execFileSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import JSZip from "jszip"

let session = process.env.SPLASH_SESSION ?? "splash-bench"
let origin =
	process.env.SPLASH_ORIGIN ?? "https://web-splash-splashbench.localhost"
let zip = new JSZip()
for (let index = 1; index <= 100; index++) {
	let title = `Splash fixture ${String(index).padStart(3, "0")}`
	zip.file(
		`${title}.md`,
		`# ${title}\n\n${"Disposable benchmark paragraph for editor readiness.\n".repeat(165)}`,
	)
}
await writeFile(
	"/tmp/splash-fixtures.zip",
	await zip.generateAsync({ type: "uint8array" }),
)
cli("open", `${origin}/app`)
cli("wait", ".cm-content")
cli("upload", 'input[type="file"][accept*=".zip"]', "/tmp/splash-fixtures.zip")
cli("fill", '[data-testid="doc-search-input"]', "Splash fixture 100")
cli("wait", '[data-doc-title="Splash fixture 100"]')
cli("click", '[data-doc-title="Splash fixture 100"]')
await sleep(2000)
console.log(cli("get", "url"))

function cli(...args: string[]) {
	return execFileSync(
		"agent-browser",
		["--session", session, "--headed", "false", ...args],
		{ encoding: "utf8" },
	)
}
