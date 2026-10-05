import { bootMarkup } from "./src/client/components/boot"
import { cp, mkdir, rm } from "node:fs/promises"
import { resolve } from "node:path"
import {
	changelogPage,
	landingPage,
	legalPage,
} from "./src/client/components/site"
import { readChangelog } from "./src/shared/changelog"
export async function build(directory = resolve(import.meta.dir, "dist")) {
	let root = import.meta.dir
	let output = resolve(directory)
	await rm(output, { recursive: true, force: true })
	await mkdir(output, { recursive: true })
	let result = await Bun.build({
		entrypoints: [resolve(root, "src/client/document-app.ts")],
		outdir: output,
		target: "browser",
		naming: { entry: "app.js", chunk: "chunks/[name]-[hash].[ext]" },
		splitting: true,
		minify: true,
		sourcemap: "external",
	})
	if (!result.success) throw new AggregateError(result.logs, "Build failed")
	await cp(resolve(root, "public"), output, { recursive: true })
	let appHtml = (await Bun.file(resolve(output, "app.html")).text()).replace(
		"<!-- APP_BOOT -->",
		String(bootMarkup()),
	)
	for (let entry of ["app"]) {
		let script = await Bun.file(resolve(output, entry + ".js")).text()
		let preloads = new Bun.Transpiler({ loader: "js" })
			.scanImports(script)
			.filter(imported => imported.kind === "import-statement")
			.map(
				imported =>
					`<link rel="modulepreload" href="/${imported.path.replace(/^\.\//, "")}">`,
			)
			.join("\n")
		await Bun.write(
			resolve(output, entry + ".html"),
			appHtml
				.replace('src="/app.js"', 'src="/' + entry + '.js"')
				.replace("</head>", preloads + "\n</head>"),
		)
	}
	await Bun.write(resolve(output, "index.html"), landingPage())
	await Bun.write(resolve(output, "en.html"), landingPage())
	await Bun.write(resolve(output, "de.html"), landingPage("de"))
	for (let [name, title] of [
		["privacy", "Privacy Policy"],
		["terms", "Terms of Use"],
		["imprint", "Impressum"],
		["support", "Support"],
	]) {
		await Bun.write(
			resolve(output, `${name}.html`),
			legalPage(
				title ?? "",
				await Bun.file(resolve(root, `public/docs/${name}.md`)).text(),
			),
		)
	}
	await Bun.write(
		resolve(output, "changelog.html"),
		changelogPage(
			readChangelog(
				await Bun.file(resolve(root, "public/changelog.json")).json(),
			),
		),
	)
	let componentStyles: string[] = []
	for await (let file of new Bun.Glob("*.css").scan(
		resolve(root, "src/client/components"),
	)) {
		let path = "/components/" + file
		await Bun.write(
			resolve(output, "." + path),
			Bun.file(resolve(root, "src/client/components", file)),
		)
		componentStyles.push(path)
	}
	let versionHasher = new Bun.CryptoHasher("sha256")
	let assets = [
		...new Bun.Glob("**/*").scanSync({
			cwd: output,
			onlyFiles: true,
		}),
	]
		.filter(path => !path.endsWith(".map"))
		.sort()
	for (let path of assets)
		versionHasher
			.update(path)
			.update(await Bun.file(resolve(output, path)).arrayBuffer())
	let version = versionHasher.digest("hex").slice(0, 16)
	let worker = await Bun.file(resolve(root, "public/sw.js")).text()
	await Bun.write(
		resolve(output, "sw.js"),
		worker
			.replace("BUILD_VERSION", version)
			.replace('"BUILD_STYLES"', "..." + JSON.stringify(componentStyles))
			.replace(
				'"BUILD_SCRIPTS"',
				"..." +
					JSON.stringify(
						assets
							.filter(path => path.endsWith(".js") && path !== "sw.js")
							.map(path => "/" + path),
					),
			),
	)
	for (let path of assets.filter(path =>
		/\.(?:js|css|html|json|webmanifest|md)$/.test(path),
	)) {
		let bytes = new Uint8Array(
			await Bun.file(resolve(output, path)).arrayBuffer(),
		)
		await Bun.write(resolve(output, path + ".gz"), Bun.gzipSync(bytes))
	}
}
if (import.meta.main) await build()
