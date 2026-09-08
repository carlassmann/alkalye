import JSZip from "jszip"
import { format, resolveConfig } from "prettier"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import * as path from "node:path"
import { readFile, writeFile } from "node:fs/promises"

let themeDirectory = import.meta.dirname
let repositoryDirectory = path.resolve(themeDirectory, "../..")
let syntwinReference =
	process.argv[2] ?? process.env.SYNTWIN_MONO_PATH ?? "../syntwin-mono"
let syntwinDirectory = path.resolve(repositoryDirectory, syntwinReference)
let archivePath = path.resolve(themeDirectory, "../syntwin.zip")
GlobalRegistrator.register()

let { parseThemeSource } =
	await import("../../src/app/features/themes/lib/source")
let { parseThemeZip } = await import("../../src/app/features/themes/lib/upload")
let { parsePresentation } =
	await import("../../src/app/features/presentation/lib/presentation")

let talkSample = await readText("sample-talk.md")
validatePresentationSample(talkSample)

let overridesCss = (await readText("overrides.css")).trim()
let documentTemplate = (await readText("document.html")).trim()
let formatOptions = await resolveConfig(themeDirectory)
let assetCss = (
	await format(await createAssetCss(), { ...formatOptions, parser: "css" })
).trim()
let stylesCss = [overridesCss, assetCss].join("\n\n")
let sourceMarkdown = createSourceMarkdown({
	overridesCss,
	assetCss,
	documentTemplate,
})

validateSource(sourceMarkdown, stylesCss, documentTemplate)
await writeFile(path.join(themeDirectory, "styles.css"), `${stylesCss}\n`)
await writeFile(path.join(themeDirectory, "source.md"), sourceMarkdown)
await writeArchive()
await validateArchive()

console.log(`Built ${path.relative(repositoryDirectory, archivePath)}`)

async function createAssetCss() {
	let markSource = await readFile(
		path.join(syntwinDirectory, "src/app/shared/ui/brand-mark.tsx"),
		"utf8",
	)
	let mark = createMarkDataUri(markSource)

	return [
		"/* Canonical Syntwin mark. */",
		":scope {",
		`  --syntwin-mark: url("${mark}");`,
		"}",
	].join("\n")
}

function createMarkDataUri(source: string) {
	let paths = [...source.matchAll(/"(M[^"\n]+Z)"/g)].map(match => match[1])
	if (paths.length !== 2)
		throw new Error("Could not read the canonical Syntwin mark")

	let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-32 0 1029 480"><path d="${paths[0]}"/><path d="${paths[1]}"/></svg>`
	return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function createSourceMarkdown(params: {
	overridesCss: string
	assetCss: string
	documentTemplate: string
}) {
	return (
		[
			"# Syntwin theme\n\nAlkalye supplies its built-in baseline at render time. This source contains only the Syntwin document and slideshow treatment. The final CSS fence contains a packaged local asset; prose is ignored by the importer.",
			"## Syntwin overrides\n\n```css theme\n" + params.overridesCss + "\n```",
			"## Packaged brand assets\n\n```css theme\n" + params.assetCss + "\n```",
			"## Document wrapper\n\n```html document\n" +
				params.documentTemplate +
				"\n```",
		].join("\n\n") + "\n"
	)
}

function validatePresentationSample(content: string) {
	let visualBlockCount = parsePresentation(content).filter(
		item => item.type === "block",
	).length
	if (!content.includes("\n  ") || visualBlockCount < 12) {
		throw new Error("Presentation sample needs indented visual blocks")
	}
}

function validateSource(
	sourceMarkdown: string,
	stylesCss: string,
	documentTemplate: string,
) {
	let source = parseThemeSource(sourceMarkdown)
	if (source.errors.length > 0) {
		throw new Error(
			`Theme source is invalid: ${source.errors.map(error => error.message).join("; ")}`,
		)
	}
	if (source.css !== stylesCss) {
		throw new Error("Theme source CSS differs from styles.css")
	}
	if (source.documentTemplate !== documentTemplate) {
		throw new Error("Theme source template differs from document.html")
	}
}

async function writeArchive() {
	let zip = new JSZip()
	zip.file("fonts/", null, {
		dir: true,
		date: new Date("1980-01-01T00:00:00.000Z"),
	})
	let files = [
		"theme.json",
		"styles.css",
		"source.md",
		"document.html",
		"sample-document.md",
		"sample-talk.md",
		"fonts/geist-latin-wght-normal.woff2",
		"fonts/geist-mono-latin-wght-normal.woff2",
		"fonts/LICENSE-Geist.txt",
		"fonts/LICENSE-Geist-Mono.txt",
	]

	for (let file of files) {
		zip.file(
			file,
			new Uint8Array(await readFile(path.join(themeDirectory, file))),
			{ date: new Date("1980-01-01T00:00:00.000Z") },
		)
	}

	let archive = await zip.generateAsync({
		type: "uint8array",
		compression: "DEFLATE",
		compressionOptions: { level: 9 },
	})
	await writeFile(archivePath, archive)
}

async function validateArchive() {
	let archive = new Uint8Array(await readFile(archivePath))
	let file = new File([archive], "syntwin.zip", {
		type: "application/zip",
	})
	let result = await parseThemeZip(file)
	if (!result.ok)
		throw new Error(`Theme archive is invalid: ${result.error.message}`)
	if (result.theme.css !== stylesCss) {
		throw new Error("Imported archive CSS differs from styles.css")
	}
	if (!result.theme.template?.includes("data-content")) {
		throw new Error("Imported archive template is missing its content slot")
	}
	if (result.theme.assets.length !== 2) {
		throw new Error("Imported archive is missing a bundled font")
	}
}

async function readText(file: string) {
	return readFile(path.join(themeDirectory, file), "utf8")
}
