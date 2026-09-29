import { readFile, writeFile } from "node:fs/promises"
import type { AstroIntegration } from "astro"

export { criticalAppPreload }

function criticalAppPreload(): AstroIntegration {
	let imports = new Map<string, string[]>()

	return {
		name: "critical-app-preload",
		hooks: {
			"astro:build:setup": ({ target, updateConfig }) => {
				if (target !== "client") return
				updateConfig({
					plugins: [
						{
							name: "critical-app-preload-graph",
							writeBundle(_, bundle) {
								for (let chunk of Object.values(bundle)) {
									if (chunk.type === "chunk") {
										imports.set(chunk.fileName, chunk.imports)
									}
								}
							},
						},
					],
				})
			},
			"astro:build:generated": async ({ dir }) => {
				let page = new URL("app/index.html", dir)
				let html = await readFile(page, "utf8")
				let component = html.match(/component-url="\/([^"]+)"/)?.[1]
				if (!component || !imports.has(component)) {
					throw new Error("Missing app component in client build graph")
				}
				let critical = new Set<string>()
				function visit(file: string) {
					if (critical.has(file) || !imports.has(file)) return
					critical.add(file)
					for (let dependency of imports.get(file) ?? []) visit(dependency)
				}
				visit(component)
				let links = [...critical]
					.map(file => `<link rel="modulepreload" href="/${file}" crossorigin>`)
					.join("")
				await writeFile(page, html.replace("<head>", `<head>${links}`))
			},
		},
	}
}
