import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"

export { fetchDatasets }

import sources from "../../bench/datasets/sources.json"

async function fetchDatasets() {
	await mkdir("bench/datasets", { recursive: true })
	for (let source of sources) {
		let file = `bench/datasets/${source.file}`
		let existing = await readFile(file).catch(() => null)
		let data: Uint8Array
		if (existing) data = existing
		else {
			let response = await fetch(source.url)
			if (!response.ok) throw new Error(`${response.status}: ${source.url}`)
			data = new Uint8Array(await response.arrayBuffer())
		}
		if (createHash("sha256").update(data).digest("hex") !== source.sha256)
			throw new Error(
				`Checksum mismatch: ${source.file}. Do not silently update the pin.`,
			)
		if (!existing) await writeFile(file, data)
	}
	return sources
}

if (process.argv[1]?.endsWith("/fetch.ts")) await fetchDatasets()
