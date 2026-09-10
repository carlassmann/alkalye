import { beforeEach, describe, expect, it } from "vitest"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { Document, UserAccount } from "@/schema"
import { persistDocumentContentSynchronously } from "@/app/features/documents/lib/background-document-save"
import { createDefaultTheme } from "./default-theme"
import { serializePortableTheme } from "./export"
import { syncThemeFromSource } from "./source"

describe("theme thumbnail source lifecycle", () => {
	beforeEach(async () => {
		await setupJazzTestSync()
	})

	it("applies and clears metadata thumbnails", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		let theme = await createDefaultTheme(account)
		if (!theme.sourceDocId) throw new Error("Theme source was not created")
		let source = await Document.load(theme.sourceDocId, {
			resolve: { content: true },
		})
		if (!source.$isLoaded) throw new Error("Theme source did not load")

		let thumbnail = "data:image/png;base64,aGVsbG8="
		let withThumbnail = sourceContent(theme.$jazz.id, thumbnail)
		persistDocumentContentSynchronously(source, withThumbnail)
		expect(
			await syncThemeFromSource(account, theme.sourceDocId, withThumbnail),
		).toBe(true)
		expect(theme.thumbnailDataUrl).toBe(thumbnail)

		let withoutThumbnail = sourceContent(theme.$jazz.id)
		persistDocumentContentSynchronously(source, withoutThumbnail)
		expect(
			await syncThemeFromSource(account, theme.sourceDocId, withoutThumbnail),
		).toBe(true)
		expect(theme.thumbnailDataUrl).toBeUndefined()
		expect(theme.thumbnail).toBeUndefined()

		let loadedTheme = await theme.$jazz.ensureLoaded({
			resolve: {
				css: true,
				template: true,
				slideTemplate: true,
				assets: { $each: { data: true } },
				thumbnail: { original: true },
			},
		})
		let exported = await serializePortableTheme(loadedTheme)
		expect(exported).not.toContain("thumbnail")
	})
})

function sourceContent(themeId: string, thumbnail?: string): string {
	let metadata = thumbnail
		? `{"name":"Default","type":"both","thumbnail":${JSON.stringify(thumbnail)}}`
		: `{"name":"Default","type":"both"}`
	return `---\ntheme-source: ${themeId}\n---\n\n\`\`\`json theme metadata\n${metadata}\n\`\`\`\n\n\`\`\`css theme\nbody {}\n\`\`\``
}
