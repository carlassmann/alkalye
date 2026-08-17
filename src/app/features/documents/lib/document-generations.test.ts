import { beforeEach, describe, expect, test } from "vitest"
import { co } from "jazz-tools"
import {
	createJazzTestAccount,
	setActiveAccount,
	setupJazzTestSync,
} from "jazz-tools/testing"
import { ArchivedDocumentContent, Document, UserAccount } from "@/schema"
import { createPersonalDocument } from "./documents"
import { syncDocumentMetadata } from "./metadata"
import {
	compactDocumentContent,
	getDocumentContentGenerations,
	getOwnDocumentContentTransactionCount,
	mergeNonConflictingText,
	reconcileArchivedDocumentContent,
} from "./document-generations"
import {
	applyContentDiffWithCommentAnchors,
	createCommentThread,
	getCommentRange,
} from "@/app/features/comments"
import {
	getContentAtEdit,
	getEditHistory,
} from "@/app/features/time-machine/lib/time-machine"
import {
	acceptDocumentInvite,
	createDocumentInvite,
	parseInviteLink,
} from "@/app/features/sharing/lib/document-sharing"

describe("document content generations", () => {
	let account: co.loaded<typeof UserAccount>

	beforeEach(async () => {
		await setupJazzTestSync()
		account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
	})

	test("rotates content while preserving document identity and comments", async () => {
		let content = "Before commented text after"
		let doc = await createPersonalDocument(account, content)
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		let thread = createCommentThread(loaded, { from: 7, to: 21 }, "Note")
		if (!thread) throw new Error("Comment not created")

		let originalDocumentId = loaded.$jazz.id
		let originalContentId = loaded.content.$jazz.id
		for (let index = 0; index < 4; index++) {
			applyContentDiffWithCommentAnchors(loaded, `${content}\nEdit ${index}`)
		}

		expect(await compactDocumentContent(loaded, 2)).toBe(true)
		expect(loaded.$jazz.id).toBe(originalDocumentId)
		expect(loaded.content.$jazz.id).not.toBe(originalContentId)
		expect(loaded.content.toString()).toBe(`${content}\nEdit 3`)
		expect(
			loaded.content.$jazz.raw.core.getValidSortedTransactions().length,
		).toBeLessThanOrEqual(2)
		expect(loaded.archivedContent).toHaveLength(1)
		expect(getCommentRange(loaded, thread.anchor)).toEqual({
			from: 7,
			to: 21,
			orphaned: false,
		})
	})

	test("preserves long comment positions during compaction", async () => {
		let selected = "x".repeat(1_500)
		let content = `Before ${selected} after`
		let doc = await createPersonalDocument(account, content)
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		let thread = createCommentThread(
			loaded,
			{ from: 7, to: 7 + selected.length },
			"Long selection",
		)
		if (!thread) throw new Error("Comment not created")

		expect(await compactDocumentContent(loaded, 0)).toBe(true)
		expect(getCommentRange(loaded, thread.anchor)).toEqual({
			from: 7,
			to: 7 + selected.length,
			orphaned: false,
		})
	})

	test("allows the successor seed in addition to the edit budget", async () => {
		let doc = await createPersonalDocument(account, "Version 1")
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		applyContentDiffWithCommentAnchors(loaded, "Version 2")
		applyContentDiffWithCommentAnchors(loaded, "Version 3")
		expect(await compactDocumentContent(loaded, 1)).toBe(true)

		let reloaded = await Document.load(loaded.$jazz.id, {
			resolve: {
				content: true,
				comments: { $each: true },
				cursors: true,
				archivedContent: { $each: true, $onError: "catch" },
			},
		})
		if (!reloaded.$isLoaded) throw new Error("Document not reloaded")
		applyContentDiffWithCommentAnchors(reloaded, "Version 4")

		expect(await compactDocumentContent(reloaded, 1)).toBe(false)
		expect(reloaded.archivedContent).toHaveLength(1)
	})

	test("Time Machine stitches archived and active generations", async () => {
		let doc = await createPersonalDocument(account, "Version 1")
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		applyContentDiffWithCommentAnchors(loaded, "Version 2")
		await new Promise(resolve => setTimeout(resolve, 5))
		applyContentDiffWithCommentAnchors(loaded, "Version 3")
		await compactDocumentContent(loaded, 1)
		await new Promise(resolve => setTimeout(resolve, 5))
		applyContentDiffWithCommentAnchors(loaded, "Version 4")

		let historical = await Document.load(doc.$jazz.id, {
			resolve: {
				content: true,
				assets: true,
				comments: { $each: { replies: true } },
				archivedContent: { $each: { content: true } },
			},
		})
		if (!historical.$isLoaded) throw new Error("History not loaded")

		let edits = getEditHistory(historical)
		let versions = edits.map((_, index) => getContentAtEdit(historical, index))
		expect(versions).toContain("Version 1")
		expect(versions).toContain("Version 2")
		expect(versions).toContain("Version 3")
		expect(versions).toContain("Version 4")
		expect(versions.filter(version => version === "Version 3")).toHaveLength(1)
	})

	test("Time Machine hides every transaction used to seed a large successor", async () => {
		let doc = await createPersonalDocument(account, "Version 1")
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		let largeVersion = `Version 2\n${"content ".repeat(300)}`
		loaded.content.$jazz.applyDiff(largeVersion)
		await new Promise(resolve => setTimeout(resolve, 5))
		await compactDocumentContent(loaded, 1)
		await new Promise(resolve => setTimeout(resolve, 5))
		let finalVersion = `${largeVersion}\nVersion 3`
		loaded.content.$jazz.applyDiff(finalVersion)

		let historical = await loaded.$jazz.ensureLoaded({
			resolve: {
				content: true,
				assets: true,
				comments: { $each: { replies: true } },
				archivedContent: { $each: { content: true } },
			},
		})
		let edits = getEditHistory(historical)
		let versions = edits.map((_, index) => getContentAtEdit(historical, index))
		let activeGenerationVersions = edits.flatMap((edit, index) =>
			edit.contentId === historical.content.$jazz.id ? [versions[index]] : [],
		)

		expect(versions.filter(version => version === largeVersion)).toHaveLength(1)
		expect(activeGenerationVersions).toEqual([finalVersion])
	})

	test("follows the winning chain across repeated rotations", async () => {
		let doc = await createPersonalDocument(account, "Generation 1")
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		applyContentDiffWithCommentAnchors(loaded, "Generation 2")
		await compactDocumentContent(loaded, 1)
		applyContentDiffWithCommentAnchors(loaded, "Generation 2.5")
		applyContentDiffWithCommentAnchors(loaded, "Generation 3")
		await compactDocumentContent(loaded, 1)

		let historical = await loaded.$jazz.ensureLoaded({
			resolve: {
				content: true,
				archivedContent: { $each: { content: true } },
			},
		})
		expect(getDocumentContentGenerations(historical)).toHaveLength(3)
		expect(historical.content.toString()).toBe("Generation 3")
	})

	test("deduplicates simultaneous compaction attempts", async () => {
		let doc = await createPersonalDocument(account, "Initial")
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		applyContentDiffWithCommentAnchors(loaded, "Changed")

		let results = await Promise.all([
			compactDocumentContent(loaded, 1),
			compactDocumentContent(loaded, 1),
		])
		expect(results.filter(Boolean)).toHaveLength(1)
	})

	test("body edits do not grow the stable document map", async () => {
		let doc = await createPersonalDocument(account, "# Stable title\n\nBody")
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		let initialTransactions =
			loaded.$jazz.raw.core.getValidSortedTransactions().length

		for (let index = 0; index < 100; index++) {
			applyContentDiffWithCommentAnchors(
				loaded,
				`# Stable title\n\nBody ${index}`,
			)
			syncDocumentMetadata(loaded)
		}

		expect(loaded.$jazz.raw.core.getValidSortedTransactions().length).toBe(
			initialTransactions,
		)
	})

	test("remote edits do not increase the owner session transaction count", async () => {
		let collaborator = await createJazzTestAccount({
			isCurrentActiveAccount: false,
			AccountSchema: UserAccount,
		})
		setActiveAccount(account)
		let doc = await createPersonalDocument(account, "Initial")
		let invite = await createDocumentInvite(doc, "writer")
		await acceptDocumentInvite(collaborator, parseInviteLink(invite.link))
		let ownerDocument = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		let ownerTransactionCount =
			getOwnDocumentContentTransactionCount(ownerDocument)

		setActiveAccount(collaborator)
		let collaboratorDocument = await Document.load(doc.$jazz.id, {
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		if (!collaboratorDocument.$isLoaded) {
			throw new Error("Collaborator document not loaded")
		}
		collaboratorDocument.content.$jazz.applyDiff("Remote edit")
		await collaboratorDocument.content.$jazz.raw.core.waitForSync({
			timeout: 1_000,
		})

		expect(getOwnDocumentContentTransactionCount(ownerDocument)).toBe(
			ownerTransactionCount,
		)
	})

	test("reconciles non-conflicting late edits from an archived generation", async () => {
		let doc = await createPersonalDocument(account, "alpha\nbeta\ngamma")
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		applyContentDiffWithCommentAnchors(loaded, "alpha\nbeta\ngamma\nready")
		await compactDocumentContent(loaded, 1)

		let archived = await loaded.$jazz.ensureLoaded({
			resolve: {
				content: true,
				comments: { $each: true },
				cursors: true,
				archivedContent: { $each: { content: true } },
			},
		})
		let generations = getDocumentContentGenerations(archived)
		let oldContent = generations[0].content
		applyContentDiffWithCommentAnchors(
			archived,
			"alpha changed\nbeta\ngamma\nready",
		)
		oldContent.$jazz.applyDiff("alpha\nbeta\ngamma changed\nready")

		expect(await reconcileArchivedDocumentContent(archived)).toBe(true)
		expect(archived.content.toString()).toBe(
			"alpha changed\nbeta\ngamma changed\nready",
		)
	})

	test("recovers a stale collaborator write after cutover", async () => {
		let collaborator = await createJazzTestAccount({
			isCurrentActiveAccount: false,
			AccountSchema: UserAccount,
		})
		setActiveAccount(account)
		let doc = await createPersonalDocument(account, "alpha\nbeta\ngamma")
		let invite = await createDocumentInvite(doc, "writer")
		await acceptDocumentInvite(collaborator, parseInviteLink(invite.link))

		setActiveAccount(collaborator)
		let stale = await Document.load(doc.$jazz.id, {
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		if (!stale.$isLoaded) throw new Error("Collaborator document not loaded")
		let staleContent = stale.content

		setActiveAccount(account)
		let current = await Document.load(doc.$jazz.id, {
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		if (!current.$isLoaded) throw new Error("Owner document not loaded")
		current.content.$jazz.applyDiff("alpha\nbeta\ngamma\nready")
		await compactDocumentContent(current, 1)
		current.content.$jazz.applyDiff("alpha changed\nbeta\ngamma\nready")

		setActiveAccount(collaborator)
		staleContent.$jazz.applyDiff("alpha\nbeta\ngamma changed\nready")
		await staleContent.$jazz.raw.core.waitForSync({ timeout: 1_000 })

		setActiveAccount(account)
		let reconciler = await Document.load(doc.$jazz.id, {
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		if (!reconciler.$isLoaded) throw new Error("Document not loaded")
		expect(await reconcileArchivedDocumentContent(reconciler)).toBe(true)
		expect(reconciler.content.toString()).toBe(
			"alpha changed\nbeta\ngamma changed\nready",
		)
	})

	test("reconciles edits made on a losing concurrent successor", async () => {
		let doc = await createPersonalDocument(account, "alpha\nbeta\ngamma")
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true }, cursors: true },
		})
		loaded.content.$jazz.applyDiff("alpha\nbeta\ngamma\nready")
		await compactDocumentContent(loaded, 1)

		let withArchives = await loaded.$jazz.ensureLoaded({
			resolve: {
				content: true,
				comments: { $each: true },
				cursors: true,
				archivedContent: { $each: { content: true, successor: true } },
			},
		})
		let source = getDocumentContentGenerations(withArchives)[0].content
		let losingSuccessor = co
			.plainText()
			.create(source.toString(), withArchives.$jazz.owner)
		let seedFrontier = losingSuccessor.$jazz.raw.core.frontier()
		losingSuccessor.$jazz.applyDiff("alpha\nbeta\ngamma changed\nready")
		let losingArchive = ArchivedDocumentContent.create(
			{
				content: source,
				successor: losingSuccessor,
				cutoverFrontier: source.$jazz.raw.core.frontier(),
				successorSeedFrontier: seedFrontier,
				cutoverAt: new Date(),
				successorId: losingSuccessor.$jazz.id,
			},
			withArchives.$jazz.owner,
		)
		withArchives.archivedContent!.$jazz.push(losingArchive)
		withArchives.content.$jazz.applyDiff("alpha changed\nbeta\ngamma\nready")

		expect(await reconcileArchivedDocumentContent(withArchives)).toBe(true)
		expect(withArchives.content.toString()).toBe(
			"alpha changed\nbeta\ngamma changed\nready",
		)
	})
})

describe("three-way text merge", () => {
	test("combines non-conflicting edits", () => {
		let merged = mergeNonConflictingText(
			"alpha\nbeta\ngamma",
			"alpha changed\nbeta\ngamma",
			"alpha\nbeta\ngamma changed",
		)
		expect(merged).toEqual({
			content: "alpha changed\nbeta\ngamma changed",
			conflicts: 0,
		})
	})

	test("does not overwrite conflicting remote edits", () => {
		let merged = mergeNonConflictingText("value", "local", "remote")
		expect(merged.content).toBe("remote")
		expect(merged.conflicts).toBeGreaterThan(0)
	})
})
