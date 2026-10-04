import { encode } from "./base64"
import { compileTheme } from "./markdown"
import { array, object, string } from "./model"
import { mediaType } from "./portable"
import type { ZipEntry } from "./zip"

export function themeFromArchive(entries: ZipEntry[]) {
	let decoder = new TextDecoder()
	let manifest = entries.find(entry => /(^|\/)theme\.json$/.test(entry.name))
	let metadata = manifest
		? object(JSON.parse(decoder.decode(manifest.data)))
		: {}
	if (manifest) {
		let sourcePath = relativePath(
			typeof metadata.source === "string" ? metadata.source : "source.md",
			manifest.name,
		)
		if (
			entries.some(
				entry =>
					/\.(md|markdown|txt)$/i.test(entry.name) && entry.name !== sourcePath,
			)
		)
			return
	}
	function file(path: unknown, fallback: string) {
		if (typeof path === "string" && manifest)
			return entries.find(
				entry => entry.name === relativePath(path, manifest.name),
			)
		return entries.find(
			entry => entry.name.endsWith("/" + fallback) || entry.name === fallback,
		)
	}
	if (
		!manifest &&
		entries.some(
			entry =>
				/\.(md|markdown|txt)$/i.test(entry.name) &&
				!/(^|\/)source\.md$/.test(entry.name),
		)
	)
		return
	let css = file(metadata.css, "theme.css")
	if (!manifest && !css) return
	let original = file(metadata.source, "source.md")
	if (original) {
		let source = decoder.decode(original.data)
		try {
			if (compileTheme(source).css) return source
		} catch {}
	}
	if (!css) return
	let assets = new Map<string, string>(),
		fences: string[] = []

	for (let entry of entries) {
		let extension = entry.name.split(".").pop()?.toLowerCase() ?? "",
			type = mediaType(entry.name)
		if (!(type.startsWith("font/") || type.startsWith("image/"))) continue
		let id = `asset-${assets.size}.${extension}`
		assets.set(entry.name, id)
		let base64 = encode(entry.data).replace(/-/g, "+").replace(/_/g, "/")
		base64 += "=".repeat((4 - (base64.length % 4)) % 4)
		fences.push(`\`\`\`base64 asset ${id} ${type}\n${base64}\n\`\`\``)
	}
	let presets = file(metadata.presets, "presets.json")
	if (presets) {
		let parsed: unknown = JSON.parse(decoder.decode(presets.data))
		metadata.presets = Array.isArray(parsed) ? parsed : object(parsed).presets
	}
	let fonts =
		metadata.fonts === undefined ? [] : array(metadata.fonts).map(object)
	let fontCss = fonts
		.map(
			font =>
				`@font-face{font-family:${JSON.stringify(string(font.name))};src:url("${reference(string(font.path), manifest?.name ?? css.name)}")}`,
		)
		.join("\n")
	let source =
		"# Imported theme\n\n```json theme metadata\n" +
		JSON.stringify(metadata, null, 2) +
		"\n```\n\n```css theme\n" +
		fontCss +
		"\n" +
		replaceCss(decoder.decode(css.data), css.name) +
		"\n```"
	for (let [filename, kind, path] of [
		["template.html", "document", metadata.template],
		["slide.html", "slide", metadata.slideTemplate],
	]) {
		let template = file(path, string(filename))
		if (template)
			source += `\n\n\`\`\`html ${kind}\n${decoder.decode(template.data).replace(/\b(src|href)=(['"])(.*?)\2/g, (_match, attribute: string, quote: string, path: string) => `${attribute}=${quote}${reference(path, template.name)}${quote}`)}\n\`\`\``
	}
	return source + (fences.length ? "\n\n" + fences.join("\n\n") : "")

	function replaceCss(source: string, file: string) {
		return source.replace(
			/url\(\s*(['"]?)([^)'"\n]+)\1\s*\)/g,
			(_match, _quote: string, path: string) =>
				`url("${reference(path.trim(), file)}")`,
		)
	}
	function reference(path: string, file: string) {
		if (/^[\w-]+:|^\/\//.test(path)) return path
		let id = assets.get(relativePath(path, file))
		return id ? "asset:" + id : path
	}
}

function relativePath(path: string, file: string) {
	let parts = file.split("/").slice(0, -1)
	for (let part of path.split(/[?#]/)[0]?.split("/") ?? []) {
		if (part === "..") parts.pop()
		else if (part && part !== ".") parts.push(part)
	}
	return parts.join("/")
}
