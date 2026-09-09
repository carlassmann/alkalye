import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { readFileSync } from "node:fs"
import { serializePortableTheme } from "@/app/features/themes/lib/export"
import { co } from "jazz-tools"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { ThemeAsset } from "@/app/features/themes/lib/schema"
import { Document, UserAccount } from "@/schema"
import { NotFoundError, PermissionError, ValidationError } from "@/cli/errors"
import {
	compileThemeSource,
	createThemeFromSource,
	deleteAccountTheme,
	getAccountTheme,
	listAccountThemes,
	themeWorkbenchUrl,
	updateThemeFromSource,
} from "./themes"

describe("CLI theme source compiler", () => {
	afterEach(() => vi.unstubAllGlobals())

	test("compiles the entire Syntwin theme with embedded fonts and logo", () => {
		let compiled = compileThemeSource(
			readFileSync("themes/syntwin.theme.md", "utf8"),
		)
		expect(compiled.css.match(/data:font\/woff2;base64,/g)).toHaveLength(2)
		expect(compiled.css).toContain("data:image/svg+xml;base64,")
		expect(compiled.css).not.toContain("asset:")
		expect(compiled.metadata?.name).toBe("Syntwin")
	})

	test("compiles CSS and HTML source", () => {
		let compiled = compileThemeSource(validSource)

		expect(compiled.css).toContain("color: red")
		expect(compiled.template).toContain("data-content")
		expect(compiled.slideTemplate).toContain("data-slide-number")
	})

	test("sanitizes real HTML and rejects text that only mentions a slot without DOM", () => {
		vi.stubGlobal("DOMParser", undefined)
		vi.stubGlobal("document", undefined)
		vi.stubGlobal("window", undefined)
		let source = `\`\`\`css theme
.theme { color: red; }
\`\`\`

\`\`\`html document
<script>alert(1)</script><main data-content onclick="alert(2)"></main>
\`\`\``
		let compiled = compileThemeSource(source)

		expect(compiled.template).not.toContain("<script")
		expect(compiled.template).not.toContain("onclick")

		let fakeSlot = source.replace(
			'<script>alert(1)</script><main data-content onclick="alert(2)"></main>',
			"<main>text mentioning data-content</main>",
		)
		expect(() => compileThemeSource(fakeSlot)).toThrow(ValidationError)

		let forbiddenSlot = source.replace(
			'<script>alert(1)</script><main data-content onclick="alert(2)"></main>',
			"<button data-content>Replace me</button>",
		)
		expect(() => compileThemeSource(forbiddenSlot)).toThrow(ValidationError)
	})
})

describe("CLI themes", () => {
	let account: co.loaded<typeof UserAccount>

	beforeEach(async () => {
		await setupJazzTestSync()
		account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
	})

	test("creates, gets, lists, updates, and deletes a theme", async () => {
		let theme = await createThemeFromSource(account, {
			name: "CLI theme",
			source: validSource,
		})
		let sourceId = theme.sourceDocId
		if (!sourceId) throw new Error("Theme source was not created")

		let source = await Document.load(sourceId, { resolve: { content: true } })
		expect(source.$isLoaded).toBe(true)
		if (!source.$isLoaded) throw new Error("Theme source did not load")
		expect(source.content.toString()).toContain(
			`theme-source: ${theme.$jazz.id}`,
		)
		expect(theme.css.toString()).toContain("color: red")
		expect(theme.template?.toString()).toContain("data-content")
		expect(theme.slideTemplate?.toString()).toContain("data-slide-number")
		expect((await getAccountTheme(account, theme.$jazz.id)).$jazz.id).toBe(
			theme.$jazz.id,
		)
		expect(
			(await listAccountThemes(account)).map(item => item.$jazz.id),
		).toContain(theme.$jazz.id)
		expect(themeWorkbenchUrl("https://example.test/", theme.$jazz.id)).toBe(
			`https://example.test/app/themes/${theme.$jazz.id}/workbench`,
		)

		await updateThemeFromSource(account, {
			themeId: theme.$jazz.id,
			name: "Updated CLI theme",
			source: updatedSource,
		})
		expect(theme.name).toBe("Updated CLI theme")
		expect(theme.css.toString()).toContain("color: blue")
		expect(theme.template).toBeUndefined()
		expect(theme.slideTemplate).toBeUndefined()
		expect(source.content.toString()).toContain("color: blue")

		await deleteAccountTheme(account, theme.$jazz.id)
		expect(
			(await listAccountThemes(account)).map(item => item.$jazz.id),
		).not.toContain(theme.$jazz.id)
		let loadedAccount = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		expect(
			loadedAccount.root.documents.some(
				document => document?.$jazz.id === sourceId,
			),
		).toBe(true)
		await expect(
			getAccountTheme(account, theme.$jazz.id),
		).rejects.toBeInstanceOf(NotFoundError)
		await expect(
			updateThemeFromSource(account, {
				themeId: theme.$jazz.id,
				source: updatedSource,
			}),
		).rejects.toBeInstanceOf(NotFoundError)
	})

	test("rejects invalid source without mutating the existing theme", async () => {
		let theme = await createThemeFromSource(account, {
			name: "Stable theme",
			source: validSource,
		})
		let before = {
			name: theme.name,
			css: theme.css.toString(),
			template: theme.template?.toString(),
			slideTemplate: theme.slideTemplate?.toString(),
		}

		await expect(
			updateThemeFromSource(account, {
				themeId: theme.$jazz.id,
				source: invalidSource,
			}),
		).rejects.toBeInstanceOf(ValidationError)
		expect({
			name: theme.name,
			css: theme.css.toString(),
			template: theme.template?.toString(),
			slideTemplate: theme.slideTemplate?.toString(),
		}).toEqual(before)
	})

	test("does not partially update when the linked source is inaccessible", async () => {
		let theme = await createThemeFromSource(account, {
			name: "Source permission theme",
			source: validSource,
		})
		let sourceId = theme.sourceDocId
		if (!sourceId) throw new Error("Theme source was not created")
		let before = {
			name: theme.name,
			css: theme.css.toString(),
			template: theme.template?.toString(),
			slideTemplate: theme.slideTemplate?.toString(),
		}
		let loadedAccount = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		let sourceIndex = loadedAccount.root.documents.findIndex(
			document => document?.$jazz.id === sourceId,
		)
		if (sourceIndex < 0)
			throw new Error("Theme source is not in document library")
		loadedAccount.root.documents.$jazz.splice(sourceIndex, 1)

		await expect(
			updateThemeFromSource(account, {
				themeId: theme.$jazz.id,
				name: "Should not apply",
				source: updatedSource,
			}),
		).rejects.toBeInstanceOf(PermissionError)
		expect({
			name: theme.name,
			css: theme.css.toString(),
			template: theme.template?.toString(),
			slideTemplate: theme.slideTemplate?.toString(),
		}).toEqual(before)
	})

	test("preserves legacy assets and exports a portable theme across accounts", async () => {
		let theme = await createThemeFromSource(account, {
			name: "Asset theme",
			source: validSource,
		})
		let loadedAccount = await account.$jazz.ensureLoaded({
			resolve: { root: true },
		})
		let owner = loadedAccount.root.$jazz.owner
		let data = await co
			.fileStream()
			.createFromArrayBuffer(
				new TextEncoder().encode("font-data").buffer,
				"font/woff2",
				"QA.woff2",
				{ owner },
			)
		let asset = ThemeAsset.create(
			{ name: "QA.woff2", mimeType: "font/woff2", data, createdAt: new Date() },
			owner,
		)
		theme.$jazz.set("assets", co.list(ThemeAsset).create([asset], owner))
		let assetId = asset.$jazz.id
		let original = await co
			.fileStream()
			.createFromArrayBuffer(
				new TextEncoder().encode("thumbnail").buffer,
				"image/png",
				"thumbnail.png",
				{ owner },
			)
		theme.$jazz.set(
			"thumbnail",
			co
				.image()
				.create({ original, originalSize: [1, 1], progressive: false }, owner),
		)

		await updateThemeFromSource(account, {
			themeId: theme.$jazz.id,
			source: updatedSource,
		})

		let loadedTheme = await theme.$jazz.ensureLoaded({
			resolve: {
				css: true,
				template: true,
				slideTemplate: true,
				assets: { $each: { data: true } },
				thumbnail: { original: true },
			},
		})
		expect(loadedTheme.assets?.map(item => item?.$jazz.id)).toEqual([assetId])
		let portable = await serializePortableTheme(loadedTheme)
		expect(portable).not.toContain("theme-source:")
		expect(portable).toContain("base64 asset")
		expect(compileThemeSource(portable).metadata?.thumbnail).toBe(
			"data:image/png;base64,dGh1bWJuYWls",
		)
		let other = await createJazzTestAccount({
			isCurrentActiveAccount: false,
			AccountSchema: UserAccount,
		})
		let imported = await createThemeFromSource(other, { source: portable })
		expect(imported.name).toBe("Asset theme")
		expect(imported.css.toString()).toContain(
			"data:font/woff2;base64,Zm9udC1kYXRh",
		)
		let reloaded = await imported.$jazz.ensureLoaded({
			resolve: {
				css: true,
				template: true,
				slideTemplate: true,
				assets: { $each: { data: true } },
				thumbnail: { original: true },
			},
		})
		let exportedAgain = await serializePortableTheme(reloaded)
		expect(compileThemeSource(exportedAgain).metadata?.thumbnail).toBe(
			"data:image/png;base64,dGh1bWJuYWls",
		)
		expect(exportedAgain.match(/```base64 asset/g)).toHaveLength(1)
		expect(exportedAgain.match(/```json theme metadata/g)).toHaveLength(1)
		expect(compileThemeSource(exportedAgain).css).toBe(imported.css.toString())
	})

	test("does not expose another account's theme library", async () => {
		let theme = await createThemeFromSource(account, {
			name: "Private theme",
			source: validSource,
		})
		let other = await createJazzTestAccount({
			isCurrentActiveAccount: false,
			AccountSchema: UserAccount,
		})

		expect(await listAccountThemes(other)).toEqual([])
		await expect(getAccountTheme(other, theme.$jazz.id)).rejects.toBeInstanceOf(
			NotFoundError,
		)
		await expect(
			updateThemeFromSource(other, {
				themeId: theme.$jazz.id,
				source: updatedSource,
			}),
		).rejects.toBeInstanceOf(NotFoundError)
		await expect(
			deleteAccountTheme(other, theme.$jazz.id),
		).rejects.toBeInstanceOf(NotFoundError)
	})
})

let validSource = `# CLI theme

\`\`\`css theme
.document .content { color: red; }
\`\`\`

\`\`\`html document
<main data-content></main>
\`\`\`

\`\`\`html slide
<section><main data-content></main><footer data-slide-number></footer></section>
\`\`\``

let updatedSource = `# Updated theme

\`\`\`css theme
.document .content { color: blue; }
\`\`\``

let invalidSource = `\`\`\`css theme
.document .content { color: green; }
\`\`\`
\`\`\`html document
<main data-content></main>
\`\`\`
\`\`\`html document
<main data-content></main>
\`\`\``
