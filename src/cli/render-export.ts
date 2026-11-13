import { Buffer } from "node:buffer"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { JSDOM } from "jsdom"
import { z } from "zod"
import { buildPrintableDocument, type PrintTheme } from "./printable-html"
import { buildPrintableSlides } from "./printable-slides"
import { compileThemeSource } from "./theme-source"
import { printHtmlToPdf } from "./pdf"
import { embedLocalImages } from "./local-images"
import { scopeThemeCss } from "@/app/features/themes/lib/scope"
import { getPresentationMode } from "@/app/features/presentation/lib/presentation"

export { renderExport }

async function renderExport(
	args: Record<string, unknown>,
	remote: (command: string, args: Record<string, unknown>) => Promise<unknown>,
	timeoutMs: number,
) {
	let content: string
	let assets: {
		id: string
		type: "image" | "video" | "tldraw"
		getBlob: () => Promise<Blob | null>
	}[] = []
	if (typeof args.file === "string") content = await readFile(args.file, "utf8")
	else {
		let bundle = z
			.object({
				content: z.string(),
				assets: z.array(
					z.object({
						id: z.string(),
						type: z.enum(["image", "video", "tldraw"]),
						mimeType: z.string().nullable(),
						data: z.string().nullable(),
					}),
				),
			})
			.parse(await remote("doc.export", args))
		content = bundle.content
		assets = bundle.assets.map(asset => ({
			id: asset.id,
			type: asset.type,
			getBlob: async () =>
				asset.data
					? new Blob([Buffer.from(asset.data, "base64")], {
							type: asset.mimeType ?? "application/octet-stream",
						})
					: null,
		}))
	}
	let theme: PrintTheme | null = null
	if (typeof args.theme === "string") {
		let compiled: ReturnType<typeof compileThemeSource>
		if (args.theme.endsWith(".theme.md") || args.theme.includes("/"))
			compiled = compileThemeSource(await readFile(args.theme, "utf8"))
		else {
			let result = z
				.object({
					name: z.string(),
					css: z.string(),
					template: z.string().nullable(),
					slideTemplate: z.string().nullable(),
				})
				.parse(await remote("theme.resolve", { name: args.theme }))
			compiled = {
				css: result.css,
				template: result.template ?? undefined,
				slideTemplate: result.slideTemplate ?? undefined,
				metadata: { name: result.name },
			}
		}
		theme = {
			name: compiled.metadata?.name ?? args.theme,
			css: scopeThemeCss(compiled.css, '[data-theme-scope="print"]'),
			template: compiled.template ?? null,
			slideTemplate: compiled.slideTemplate ?? null,
			presetVariables: "",
			fontFaceRules: "",
		}
	}
	let parseHtml = (html: string) => new JSDOM(html).window.document
	let layout =
		args.layout ?? (getPresentationMode(content) ? "slides" : "document")
	let html =
		layout === "document"
			? await buildPrintableDocument({
					content,
					theme,
					assets,
					defaultSyntaxTheme: null,
					parseHtml,
				})
			: await buildPrintableSlides({
					content,
					theme,
					assets,
					defaultSyntaxTheme: null,
					parseHtml,
					layout: z.enum(["slides", "notes"]).parse(layout),
					aspectRatio: z.enum(["16:9", "4:3"]).parse(args.aspect ?? "16:9"),
				})
	if (typeof args.file === "string")
		html = await embedLocalImages(html, dirname(resolve(args.file)))
	if (typeof args.html !== "string" && typeof args.pdf !== "string")
		throw new Error("Provide --html or --pdf")
	if (typeof args.html === "string") await writeFile(args.html, html)
	if (typeof args.pdf === "string")
		await printHtmlToPdf({
			html,
			outputPath: args.pdf,
			timeoutMs: Math.max(timeoutMs, 60000),
		})
	return { html: args.html, pdf: args.pdf, layout }
}
