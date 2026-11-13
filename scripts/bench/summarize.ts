import { readFile, writeFile } from "node:fs/promises"
import { z } from "zod"

let finalResults = [
	"classic",
	"v2",
	"v2-optimized",
	"v2-optimized-load",
	"v2-optimized-brotli",
	"classic-5000",
	"v2-5000",
]
for (let name of finalResults) {
	let source = `bench/results/raw/${name}.json`
	let raw: unknown = JSON.parse(await readFile(source, "utf8"))
	await writeFile(
		`bench/results/${name}.json`,
		JSON.stringify(summarize(raw), null, "\t") + "\n",
	)
}

function summarize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(summarize)
	if (!value || typeof value !== "object") return value
	let record = z.record(z.string(), z.unknown()).parse(value)
	let result: Record<string, unknown> = {}
	for (let [key, entry] of Object.entries(record)) {
		if (
			[
				"bundleTransfers",
				"syncDiagnostics",
				"serviceWorkerDiagnostics",
				"excludedPostReplaySwFailures",
			].includes(key)
		)
			continue
		if (key === "samples" && Array.isArray(entry))
			result.sampleCount = entry.length
		else result[key] = summarize(entry)
	}
	return result
}
