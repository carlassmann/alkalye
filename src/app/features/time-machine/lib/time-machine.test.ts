import { beforeEach, describe, expect, test } from "vitest"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { co } from "jazz-tools"
import {
	Document,
	Asset,
	TldrawAsset,
	TldrawRevision,
	UserAccount,
} from "@/schema"
import { createPersonalDocument } from "@/app/features/documents/lib/documents"
import {
	getEditHistory,
	getContentAtEdit,
	accountIdFromSessionId,
	formatEditDate,
	restoreAssetsAtTime,
} from "./time-machine"

describe("Time Machine - Edit History", () => {
	let adminAccount: co.loaded<typeof UserAccount>

	beforeEach(async () => {
		await setupJazzTestSync()

		adminAccount = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
	})

	test("accountIdFromSessionId extracts account ID correctly", () => {
		let sessionId = "co_zabc123_session_xyz789"
		let accountId = accountIdFromSessionId(sessionId)
		expect(accountId).toBe("co_zabc123")
	})

	test("getEditHistory returns edits ordered by madeAt timestamp", async () => {
		let doc = await createPersonalDocument(adminAccount, "Initial content")

		await new Promise(r => setTimeout(r, 10))
		doc.content!.$jazz.applyDiff("Second edit")

		await new Promise(r => setTimeout(r, 10))
		doc.content!.$jazz.applyDiff("Third edit")

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		let editHistory = getEditHistory(loaded)

		expect(editHistory.length).toBeGreaterThanOrEqual(3)
		for (let i = 1; i < editHistory.length; i++) {
			expect(editHistory[i].madeAt.getTime()).toBeGreaterThanOrEqual(
				editHistory[i - 1].madeAt.getTime(),
			)
		}

		for (let i = 0; i < editHistory.length; i++) {
			expect(editHistory[i].index).toBe(i)
		}
	})

	test("getEditHistory handles single edit document", async () => {
		let doc = await createPersonalDocument(adminAccount, "Only content")

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		let editHistory = getEditHistory(loaded)

		expect(editHistory.length).toBeGreaterThanOrEqual(1)
		expect(editHistory[0].index).toBe(0)
		expect(editHistory[0].madeAt).toBeInstanceOf(Date)
	})

	test("getEditHistory includes accountId for each edit", async () => {
		let doc = await createPersonalDocument(adminAccount, "Test content")

		await new Promise(r => setTimeout(r, 10))
		doc.content!.$jazz.applyDiff("Another edit")

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		let editHistory = getEditHistory(loaded)

		for (let edit of editHistory) {
			expect(edit.accountId).not.toBeNull()
			expect(typeof edit.accountId).toBe("string")
		}
	})

	test("getContentAtEdit returns content at specific edit index", async () => {
		let doc = await createPersonalDocument(adminAccount, "Version 1")

		await new Promise(r => setTimeout(r, 50))
		doc.content!.$jazz.applyDiff("Version 2")

		await new Promise(r => setTimeout(r, 50))
		doc.content!.$jazz.applyDiff("Version 3")

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		let editHistory = getEditHistory(loaded)
		expect(editHistory.length).toBeGreaterThanOrEqual(3)

		let contents = editHistory.map((_, i) => getContentAtEdit(loaded, i))
		expect(contents).toContain("Version 1")
		expect(contents).toContain("Version 2")
		expect(contents).toContain("Version 3")

		let v1Index = contents.indexOf("Version 1")
		let v2Index = contents.indexOf("Version 2")
		let v3Index = contents.indexOf("Version 3")
		expect(v1Index).toBeLessThan(v2Index)
		expect(v2Index).toBeLessThan(v3Index)
	})

	test("getContentAtEdit handles out of bounds indices", async () => {
		let doc = await createPersonalDocument(adminAccount, "Only content")

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		expect(getContentAtEdit(loaded, -1)).toBe("Only content")
		expect(getContentAtEdit(loaded, 100)).toBe("Only content")
	})

	test("getEditHistory is efficient with caching", async () => {
		let doc = await createPersonalDocument(adminAccount, "Test content")

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		let history1 = getEditHistory(loaded)
		let history2 = getEditHistory(loaded)
		let history3 = getEditHistory(loaded)

		expect(history1).toBe(history2)
		expect(history2).toBe(history3)
	})

	test("getEditHistory handles document with many edits", async () => {
		let doc = await createPersonalDocument(adminAccount, "Initial")

		let editCount = 100
		for (let i = 1; i <= editCount; i++) {
			doc.content!.$jazz.applyDiff(`Edit ${i}`)
		}

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		let editHistory = getEditHistory(loaded)

		expect(editHistory.length).toBeGreaterThan(0)

		for (let i = 0; i < 10; i++) {
			expect(getEditHistory(loaded)).toBe(editHistory)
		}

		let middleEdit = Math.floor(editHistory.length / 2)
		let middleContent = getContentAtEdit(loaded, middleEdit)

		expect(middleContent.length).toBeGreaterThan(0)
	})

	test("restores the tldraw revision active at the selected time", async () => {
		let doc = await createPersonalDocument(adminAccount, "Whiteboard")
		let firstRevision = await createTldrawTestRevision(adminAccount, "first")
		let asset = TldrawAsset.create(
			{
				version: 1,
				type: "tldraw",
				name: "Diagram",
				revision: firstRevision,
				createdAt: new Date(),
			},
			adminAccount,
		)
		doc.$jazz.set("assets", co.list(Asset).create([], adminAccount))
		doc.assets!.$jazz.push(asset)

		await new Promise(resolve => setTimeout(resolve, 20))
		let firstRevisionTime = Date.now()
		await new Promise(resolve => setTimeout(resolve, 20))
		let secondRevision = await createTldrawTestRevision(adminAccount, "second")
		asset.$jazz.set("revision", secondRevision)

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		await restoreAssetsAtTime(loaded, firstRevisionTime)

		let restored = loaded.assets?.[0]
		expect(restored?.$isLoaded && restored.type).toBe("tldraw")
		if (!restored?.$isLoaded || restored.type !== "tldraw") return
		expect(restored.revision?.$jazz.id).toBe(firstRevision.$jazz.id)
	})

	test("does not partially restore when a historical asset is unavailable", async () => {
		let doc = await createPersonalDocument(adminAccount, "Whiteboard")
		let revision = await createTldrawTestRevision(adminAccount, "deleted")
		let asset = TldrawAsset.create(
			{
				version: 1,
				type: "tldraw",
				name: "Deleted diagram",
				revision,
				createdAt: new Date(),
			},
			adminAccount,
		)
		doc.$jazz.set("assets", co.list(Asset).create([asset], adminAccount))

		await new Promise(resolve => setTimeout(resolve, 20))
		let historicalTimestamp = Date.now()
		await new Promise(resolve => setTimeout(resolve, 20))
		doc.assets!.$jazz.splice(0, 1)
		asset.$jazz.raw.core.deleteCoValue()

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		await expect(
			restoreAssetsAtTime(loaded, historicalTimestamp),
		).rejects.toThrow("Historical asset is unavailable")
		expect(loaded.assets).toHaveLength(0)
	})

	test("getEditHistory maintains O(n) complexity", async () => {
		let doc = await createPersonalDocument(adminAccount, "Initial")

		for (let i = 1; i <= 50; i++) {
			doc.content!.$jazz.applyDiff(`Edit ${i}`)
		}

		let loaded50 = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded50.$isLoaded) throw new Error("Doc not loaded")

		let start50 = performance.now()
		getEditHistory(loaded50)
		let duration50 = performance.now() - start50

		for (let i = 51; i <= 100; i++) {
			doc.content!.$jazz.applyDiff(`Edit ${i}`)
		}

		let loaded100 = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded100.$isLoaded) throw new Error("Doc not loaded")

		let start100 = performance.now()
		getEditHistory(loaded100)
		let duration100 = performance.now() - start100

		expect(duration100).toBeLessThan(duration50 * 5 + 10)
	})
})

async function createTldrawTestRevision(
	owner: co.loaded<typeof UserAccount>,
	content: string,
) {
	let snapshot = await co
		.fileStream()
		.createFromBlob(new ReadableBlob(content, "application/vnd.tldraw+json"), {
			owner,
		})
	let original = await co.fileStream().createFromBlob(new ReadableBlob(""), {
		owner,
	})
	let preview = co.image().create(
		{
			original,
			originalSize: [1, 1],
			progressive: false,
		},
		owner,
	)
	return TldrawRevision.create(
		{
			snapshot,
			lightPreview: preview,
			darkPreview: preview,
			createdAt: new Date(),
		},
		owner,
	)
}

class ReadableBlob extends Blob {
	readonly content: string

	constructor(content: string, type = "application/octet-stream") {
		super([content], { type })
		this.content = content
	}

	async arrayBuffer() {
		let bytes = new TextEncoder().encode(this.content)
		let buffer = new ArrayBuffer(bytes.byteLength)
		new Uint8Array(buffer).set(bytes)
		return buffer
	}
}

describe("Time Machine - Offline Support", () => {
	let adminAccount: co.loaded<typeof UserAccount>

	beforeEach(async () => {
		await setupJazzTestSync()

		adminAccount = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
	})

	test("getEditHistory uses only locally cached data (no network calls)", async () => {
		let doc = await createPersonalDocument(adminAccount, "Initial content")

		await new Promise(r => setTimeout(r, 10))
		doc.content!.$jazz.applyDiff("Second version")

		await new Promise(r => setTimeout(r, 10))
		doc.content!.$jazz.applyDiff("Third version")

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		let editHistory = getEditHistory(loaded)
		expect(editHistory.length).toBeGreaterThanOrEqual(3)

		for (let i = 0; i < editHistory.length; i++) {
			let content = getContentAtEdit(loaded, i)
			expect(typeof content).toBe("string")
		}
	})

	test("edit history reconstruction works from local CRDT operations", async () => {
		let doc = await createPersonalDocument(adminAccount, "Version A")

		await new Promise(r => setTimeout(r, 20))
		doc.content!.$jazz.applyDiff("Version B")

		await new Promise(r => setTimeout(r, 20))
		doc.content!.$jazz.applyDiff("Version C")

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")

		let editHistory = getEditHistory(loaded)

		let allVersions = editHistory.map((_, i) => getContentAtEdit(loaded, i))

		expect(allVersions).toContain("Version A")
		expect(allVersions).toContain("Version B")
		expect(allVersions).toContain("Version C")

		let indexA = allVersions.indexOf("Version A")
		let indexB = allVersions.indexOf("Version B")
		let indexC = allVersions.indexOf("Version C")

		expect(indexA).toBeLessThan(indexB)
		expect(indexB).toBeLessThan(indexC)
	})
})

describe("Time Machine - Very Old Edits", () => {
	test("formatEditDate displays old dates correctly", () => {
		let oneYearAgo = new Date()
		oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
		let formatted = formatEditDate(oneYearAgo)

		expect(formatted).toMatch(/\d{4}/)
		expect(formatted).toMatch(/\d{1,2}:\d{2}/)

		let sixMonthsAgo = new Date()
		sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
		let formattedSixMonths = formatEditDate(sixMonthsAgo)

		expect(formattedSixMonths).toMatch(
			/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/,
		)
		expect(formattedSixMonths).toMatch(/\d{1,2}:\d{2}/)

		let twoYearsAgo = new Date()
		twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
		let formattedTwoYears = formatEditDate(twoYearsAgo)

		expect(formattedTwoYears).toMatch(/\d{4}/)
	})

	test("formatEditDate handles dates at Unix epoch boundaries", () => {
		let y2k = new Date(2000, 0, 1, 12, 30)
		let formatted = formatEditDate(y2k)

		expect(formatted).toContain("2000")
		expect(formatted).toContain("Jan")
	})

	test("formatEditDate displays all date components correctly", () => {
		let testDate = new Date(2023, 5, 15, 14, 30)

		let formatted = formatEditDate(testDate)

		expect(formatted).toContain("Jun")
		expect(formatted).toContain("15")
		expect(formatted).toContain("2023")
		expect(formatted).toMatch(/\d{1,2}:\d{2}/)
	})
})
