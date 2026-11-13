import { execFileSync } from "node:child_process"
import { mkdir, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { z } from "zod"

export { loadDatasets }

async function loadDatasets(notes: number) {
	await mkdir("bench/datasets/vite", { recursive: true })
	execFileSync("tar", [
		"xzf",
		"bench/datasets/vite.tar.gz",
		"-C",
		"bench/datasets/vite",
		"--strip-components=1",
		"--wildcards",
		"*/docs/*.md",
	])

	let paths = (await readdir("bench/datasets/vite/docs", { recursive: true }))
		.filter(path => path.endsWith(".md"))
		.sort()
		.slice(0, notes)
	if (paths.length !== notes)
		throw new Error(`Only ${paths.length} notes available`)
	let documents = await Promise.all(
		paths.map(async (path, index) => ({
			title: `Corpus ${index.toString().padStart(3, "0")}`,
			content: `# Corpus ${index.toString().padStart(3, "0")}\n\n${await readFile(join("bench/datasets/vite/docs", path), "utf8")}`,
			source: path,
		})),
	)
	for (let name of ["alice", "dracula"])
		documents.push({
			title: `Book ${name}`,
			content: `# Book ${name}\n\n${await readFile(`bench/datasets/${name}.txt`, "utf8")}`,
			source: `${name}.txt`,
		})
	for (let document of documents)
		document.content = `---\ntitle: ${document.title}\n---\n\n${document.content.replace(/\r\n?/g, "\n")}`
	let traceSource = await readFile("bench/datasets/trace.js", "utf8")
	let raw: unknown = runInNewContext(
		traceSource + ";({edits, finalText})",
		{},
		{ timeout: 10_000 },
	)
	let trace = z
		.object({
			edits: z.array(
				z.tuple([
					z.number().int().nonnegative(),
					z.number().int().nonnegative(),
					z.string().optional(),
				]),
			),
			finalText: z.string(),
		})
		.parse(raw)
	return { documents, trace }
}
