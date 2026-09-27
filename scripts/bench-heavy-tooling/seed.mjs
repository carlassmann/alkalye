import JSZip from "jszip"
import { mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import console from "node:console"
import { browser } from "./cdp.mjs"

mkdirSync("/tmp/alkalye-heavy", { recursive: true })
let zip = new JSZip()
for (let i = 1; i <= 100; i++) {
	let title = `Heavy fixture ${String(i).padStart(3, "0")}`
	zip.file(
		`${title}.md`,
		`# ${title}\n\n` +
			"Synthetic offline writing fixture. No personal information.\n".repeat(
				72,
			),
	)
}
writeFileSync(
	"/tmp/alkalye-heavy/fixture.zip",
	await zip.generateAsync({ type: "uint8array" }),
)
execFileSync("ffmpeg", [
	"-v",
	"error",
	"-y",
	"-f",
	"lavfi",
	"-i",
	"testsrc=size=320x240:rate=24",
	"-f",
	"lavfi",
	"-i",
	"sine=frequency=440:sample_rate=48000",
	"-t",
	"1",
	"-c:v",
	"libx264",
	"-pix_fmt",
	"yuv420p",
	"-c:a",
	"aac",
	"/tmp/alkalye-heavy/heavy-video.mp4",
])
browser("open", "http://localhost:4317/app")
browser("wait", '[data-testid="doc-list-item"]')
browser(
	"upload",
	'input[type="file"][accept*=".zip"]',
	"/tmp/alkalye-heavy/fixture.zip",
)
browser("wait", '[data-doc-title="Heavy fixture 100"]')
console.log(
	browser(
		"eval",
		`document.querySelector('[data-doc-title="Heavy fixture 100"] a').href + '?benchmarkDocument=Heavy%20fixture%20100'`,
	),
)
