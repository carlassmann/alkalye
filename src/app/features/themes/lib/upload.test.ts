import { describe, it, expect } from "vitest"
import JSZip from "jszip"
import { parseThemeMarkdown, parseThemeZip, validateThemeJson } from "./upload"

// Helper to create a zip file from object mapping paths to contents
async function createZip(
	files: Record<string, string | Uint8Array>,
): Promise<File> {
	let zip = new JSZip()
	for (let [path, content] of Object.entries(files)) {
		zip.file(path, content)
	}
	let blob = await zip.generateAsync({ type: "blob" })
	return new File([blob], "theme.zip", { type: "application/zip" })
}

describe("validateThemeJson", () => {
	it("validates a correct theme.json", () => {
		let json = JSON.stringify({
			version: 1,
			name: "Test Theme",
			author: "Test Author",
			description: "A test theme",
			type: "both",
			css: "styles.css",
		})
		let result = validateThemeJson(json)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data.name).toBe("Test Theme")
			expect(result.data.type).toBe("both")
		}
	})

	it("rejects invalid JSON", () => {
		let result = validateThemeJson("not valid json {")
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("invalid_manifest")
			expect(result.error.message).toContain("not valid JSON")
		}
	})

	it("requires version field to be 1", () => {
		let json = JSON.stringify({
			version: 2,
			name: "Test",
			type: "preview",
			css: "styles.css",
		})
		let result = validateThemeJson(json)
		expect(result.ok).toBe(false)
	})

	it("requires name field", () => {
		let json = JSON.stringify({
			version: 1,
			type: "preview",
			css: "styles.css",
		})
		let result = validateThemeJson(json)
		expect(result.ok).toBe(false)
		if (!result.ok && "errors" in result.error) {
			expect(result.error.errors.some((e: string) => e.includes("name"))).toBe(
				true,
			)
		}
	})

	it("requires css field", () => {
		let json = JSON.stringify({
			version: 1,
			name: "Test",
			type: "preview",
		})
		let result = validateThemeJson(json)
		expect(result.ok).toBe(false)
		if (!result.ok && "errors" in result.error) {
			expect(result.error.errors.some((e: string) => e.includes("css"))).toBe(
				true,
			)
		}
	})

	it("requires type to be preview, slideshow, or both", () => {
		let json = JSON.stringify({
			version: 1,
			name: "Test",
			type: "invalid",
			css: "styles.css",
		})
		let result = validateThemeJson(json)
		expect(result.ok).toBe(false)
	})

	it("accepts all valid type values", () => {
		for (let type of ["preview", "slideshow", "both"]) {
			let json = JSON.stringify({
				version: 1,
				name: "Test",
				type,
				css: "styles.css",
			})
			let result = validateThemeJson(json)
			expect(result.ok).toBe(true)
		}
	})

	it("accepts optional fields", () => {
		let json = JSON.stringify({
			version: 1,
			name: "Test",
			author: "Author",
			description: "Desc",
			type: "both",
			css: "styles.css",
			template: "doc.html",
			presets: "presets.json",
			thumbnail: "thumb.png",
			fonts: [{ name: "MyFont.woff2", path: "fonts/MyFont.woff2" }],
		})
		let result = validateThemeJson(json)
		expect(result.ok).toBe(true)
	})
})

describe("parseThemeMarkdown", () => {
	it("imports metadata, editable source, and base64 assets", async () => {
		let source = `# Portable\n\nprose\n\n\`\`\`css theme\nbody { color: red; } @font-face { font-family: Test; src: url(asset:assets/0-font.woff2); }\n\`\`\`\n\n\`\`\`json theme metadata\n{"name":"Portable","type":"preview","presets":[]}\n\`\`\`\n\n\`\`\`base64 asset assets/0-font.woff2 font/woff2\nZm9udA==\n\`\`\``
		let result = await parseThemeMarkdown(
			new File([source], "portable.theme.md"),
		)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.theme.name).toBe("Portable")
			expect(result.theme.css).toContain("color: red")
			expect(result.theme.source).toBe(source)
			expect(result.theme.css).toContain("data:font/woff2;base64,Zm9udA==")
			expect(result.theme.assets).toHaveLength(0)
		}
	})

	it("uses a heading when metadata is omitted", async () => {
		let source = "# Heading Theme\n\n```css theme\nbody {}\n```"
		let result = await parseThemeMarkdown(new File([source], "theme.md"))
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.theme.name).toBe("Heading Theme")
	})
})

describe("parseThemeZip - basic upload", () => {
	it("parses a valid theme zip with theme.json at root", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test Theme",
				author: "Test",
				type: "preview",
				css: "styles.css",
			}),
			"styles.css": "body { color: red; }",
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.theme.name).toBe("Test Theme")
			expect(result.theme.author).toBe("Test")
			expect(result.theme.type).toBe("preview")
			expect(result.theme.css).toBe("body { color: red; }")
		}
	})

	it("parses a theme zip with theme.json in a folder", async () => {
		let file = await createZip({
			"MyTheme/theme.json": JSON.stringify({
				version: 1,
				name: "Nested Theme",
				type: "slideshow",
				css: "styles.css",
			}),
			"MyTheme/styles.css": "h1 { font-size: 2em; }",
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.theme.name).toBe("Nested Theme")
			expect(result.theme.css).toBe("h1 { font-size: 2em; }")
		}
	})

	it("returns error for invalid zip", async () => {
		let file = new File(["not a zip"], "fake.zip", {
			type: "application/zip",
		})
		let result = await parseThemeZip(file)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("invalid_zip")
		}
	})

	it("returns error when theme.json is missing", async () => {
		let file = await createZip({
			"styles.css": "body { color: red; }",
		})
		let result = await parseThemeZip(file)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("missing_manifest")
			expect(result.error.message).toContain("theme.json not found")
		}
	})
})

describe("parseThemeZip - CSS handling", () => {
	it("returns error when CSS file is missing", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "missing.css",
			}),
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("missing_css")
			expect(result.error.message).toContain("missing.css")
		}
	})

	it("sanitizes dangerous CSS patterns", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "styles.css",
			}),
			"styles.css": `
body { background: url(javascript:alert(1)); }
div { width: expression(alert(1)); }
h1 { color: red; }
`,
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			// Dangerous patterns should be replaced with comments marking removal
			expect(result.theme.css).toContain("/* removed:")
			// The dangerous patterns should be inside comments (neutralized)
			// Not as executable CSS like: url(javascript:...) or width: expression(...)
			expect(result.theme.css).not.toMatch(/url\s*\(\s*javascript:/i)
			expect(result.theme.css).not.toMatch(/width\s*:\s*expression\s*\(/i)
			// Safe CSS should remain
			expect(result.theme.css).toContain("color: red")
		}
	})
})

describe("parseThemeZip - presets", () => {
	it("parses presets.json when specified", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "both",
				css: "styles.css",
				presets: "presets.json",
			}),
			"styles.css": "body {}",
			"presets.json": JSON.stringify({
				presets: [
					{
						name: "Light",
						appearance: "light",
						colors: {
							background: "#ffffff",
							foreground: "#000000",
							accent: "#0066cc",
						},
					},
					{
						name: "Dark",
						appearance: "dark",
						colors: {
							background: "#1a1a1a",
							foreground: "#ffffff",
							accent: "#66b3ff",
						},
					},
				],
			}),
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.theme.presets).toHaveLength(2)
			expect(result.theme.presets![0].name).toBe("Light")
			expect(result.theme.presets![0].appearance).toBe("light")
			expect(result.theme.presets![1].name).toBe("Dark")
			expect(result.theme.presets![1].appearance).toBe("dark")
		}
	})

	it("accepts presets as top-level array", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "both",
				css: "styles.css",
				presets: "presets.json",
			}),
			"styles.css": "body {}",
			"presets.json": JSON.stringify([
				{
					name: "Light",
					appearance: "light",
					colors: {
						background: "#fff",
						foreground: "#000",
						accent: "#00f",
					},
				},
			]),
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.theme.presets).toHaveLength(1)
		}
	})

	it("returns error for invalid presets format", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "both",
				css: "styles.css",
				presets: "presets.json",
			}),
			"styles.css": "body {}",
			"presets.json": JSON.stringify({
				presets: [
					{
						name: "Bad Preset",
						// missing required fields: appearance, colors
					},
				],
			}),
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("invalid_presets")
		}
	})

	it("returns error for invalid presets JSON", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "both",
				css: "styles.css",
				presets: "presets.json",
			}),
			"styles.css": "body {}",
			"presets.json": "not valid json {{{",
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("invalid_presets")
		}
	})

	it("parses presets with optional colors", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "both",
				css: "styles.css",
				presets: "presets.json",
			}),
			"styles.css": "body {}",
			"presets.json": JSON.stringify({
				presets: [
					{
						name: "Full",
						appearance: "light",
						colors: {
							background: "#fff",
							foreground: "#000",
							accent: "#00f",
							heading: "#111",
							link: "#00f",
							codeBackground: "#f0f0f0",
							accents: ["#f00", "#0f0", "#00f"],
						},
						fonts: {
							title: "Georgia",
							body: "Verdana",
						},
					},
				],
			}),
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			let preset = result.theme.presets![0]
			expect(preset.colors.heading).toBe("#111")
			expect(preset.colors.link).toBe("#00f")
			expect(preset.colors.codeBackground).toBe("#f0f0f0")
			expect(preset.colors.accents).toEqual(["#f00", "#0f0", "#00f"])
			expect(preset.fonts?.title).toBe("Georgia")
			expect(preset.fonts?.body).toBe("Verdana")
		}
	})
})

describe("parseThemeZip - fonts", () => {
	it("extracts font files listed in theme.json", async () => {
		let fontData = new Uint8Array([0, 1, 2, 3, 4, 5]) // Mock font data
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "styles.css",
				fonts: [
					{ name: "MyFont.woff2", path: "fonts/MyFont.woff2" },
					{ name: "MyFont-Bold.woff2", path: "fonts/MyFont-Bold.woff2" },
				],
			}),
			"styles.css": "body {}",
			"fonts/MyFont.woff2": fontData,
			"fonts/MyFont-Bold.woff2": fontData,
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.theme.assets).toHaveLength(2)
			expect(result.theme.assets[0].name).toBe("MyFont.woff2")
			expect(result.theme.assets[0].mimeType).toBe("font/woff2")
			expect(result.theme.assets[1].name).toBe("MyFont-Bold.woff2")
		}
	})

	it("handles missing font files gracefully", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "styles.css",
				fonts: [{ name: "Missing.woff2", path: "fonts/Missing.woff2" }],
			}),
			"styles.css": "body {}",
			// Font file not included
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			// Missing fonts are skipped, not errors
			expect(result.theme.assets).toHaveLength(0)
		}
	})

	it("detects correct mime types for font extensions", async () => {
		let fontData = new Uint8Array([0, 1, 2, 3])
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "styles.css",
				fonts: [
					{ name: "font.woff2", path: "font.woff2" },
					{ name: "font.woff", path: "font.woff" },
					{ name: "font.ttf", path: "font.ttf" },
					{ name: "font.otf", path: "font.otf" },
				],
			}),
			"styles.css": "body {}",
			"font.woff2": fontData,
			"font.woff": fontData,
			"font.ttf": fontData,
			"font.otf": fontData,
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			let mimeTypes = result.theme.assets.map(a => a.mimeType)
			expect(mimeTypes).toContain("font/woff2")
			expect(mimeTypes).toContain("font/woff")
			expect(mimeTypes).toContain("font/ttf")
			expect(mimeTypes).toContain("font/otf")
		}
	})
})

describe("parseThemeZip - templates", () => {
	it("parses HTML template when specified", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "styles.css",
				template: "document.html",
			}),
			"styles.css": "body {}",
			"document.html": `<!DOCTYPE html>
<html>
<head><title>Template</title></head>
<body><div data-document></div></body>
</html>`,
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.theme.template).toContain("data-document")
		}
	})

	it("sanitizes dangerous HTML in templates", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "styles.css",
				template: "document.html",
			}),
			"styles.css": "body {}",
			"document.html": `<!DOCTYPE html>
<html>
<head>
<script>alert('xss')</script>
</head>
<body onload="alert('xss')">
<div data-document></div>
</body>
</html>`,
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			// Scripts should be removed
			expect(result.theme.template).not.toContain("<script>")
			// Event handlers should be removed
			expect(result.theme.template).not.toContain("onload")
			// Safe content should remain
			expect(result.theme.template).toContain("data-document")
		}
	})

	it("handles missing template file gracefully", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "styles.css",
				template: "missing.html",
			}),
			"styles.css": "body {}",
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			// Missing template is treated as optional
			expect(result.theme.template).toBeUndefined()
		}
	})
})

describe("parseThemeZip - thumbnails", () => {
	it("extracts thumbnail when specified", async () => {
		let pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "styles.css",
				thumbnail: "thumb.png",
			}),
			"styles.css": "body {}",
			"thumb.png": pngData,
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.theme.thumbnail).toBeDefined()
			expect(result.theme.thumbnail?.type).toBe("image/png")
		}
	})

	it("handles missing thumbnail gracefully", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "styles.css",
				thumbnail: "missing.png",
			}),
			"styles.css": "body {}",
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.theme.thumbnail).toBeUndefined()
		}
	})
})

describe("parseThemeZip - error messages", () => {
	it("provides helpful error for missing name field", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				type: "preview",
				css: "styles.css",
			}),
			"styles.css": "body {}",
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("invalid_manifest")
			// Should mention "name" in error
			let hasNameError =
				result.error.message.toLowerCase().includes("name") ||
				("errors" in result.error &&
					result.error.errors.some((e: string) =>
						e.toLowerCase().includes("name"),
					))
			expect(hasNameError).toBe(true)
		}
	})

	it("provides helpful error for missing CSS", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "preview",
				css: "nonexistent.css",
			}),
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("missing_css")
			expect(result.error.message).toContain("nonexistent.css")
		}
	})

	it("provides detailed preset validation errors", async () => {
		let file = await createZip({
			"theme.json": JSON.stringify({
				version: 1,
				name: "Test",
				type: "both",
				css: "styles.css",
				presets: "presets.json",
			}),
			"styles.css": "body {}",
			"presets.json": JSON.stringify({
				presets: [
					{
						name: "Incomplete",
						appearance: "light",
						// colors is missing required fields
						colors: {
							background: "#fff",
							// foreground and accent missing
						},
					},
				],
			}),
		})

		let result = await parseThemeZip(file)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("invalid_presets")
			expect("errors" in result.error).toBe(true)
			if ("errors" in result.error) {
				// Should have specific field errors
				expect(result.error.errors.length).toBeGreaterThan(0)
			}
		}
	})
})
