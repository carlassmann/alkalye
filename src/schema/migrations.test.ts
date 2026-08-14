import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { LocalNode } from "cojson"
import type { CoValueCore } from "cojson"
import {
	createJazzTestAccount,
	setupJazzTestSync,
	setActiveAccount,
	TestJSCrypto,
} from "jazz-tools/testing"
import { Group, co, z } from "jazz-tools"
import {
	UserAccount,
	UserProfile,
	UserRoot,
	Document,
	Asset,
	CursorFeed,
	CommentThread,
	Space,
	Settings,
	Theme,
} from "@/schema"
import { HighlightRange } from "@/app/features/documents/lib/schema"
import {
	backfillDocumentMetadata,
	needsMetadataBackfill,
} from "@/app/features/documents/lib/metadata"
import {
	runAccountMigration,
	setMigrationFullDownloadTimeout,
} from "./migrations"
import {
	clearLastOpenedDocument,
	readLastOpenedDocument,
	writeLastOpenedDocument,
} from "@/app/features/documents/lib/last-opened-document"

let BareAccount = co
	.account({ profile: UserProfile, root: UserRoot })
	.withMigration((account, creationProps?: { name: string }) => {
		if (!account.$jazz.has("profile")) {
			let profileGroup = Group.create()
			profileGroup.makePublic()
			account.$jazz.set(
				"profile",
				UserProfile.create(
					{ name: creationProps?.name ?? "Fixture" },
					profileGroup,
				),
			)
		}
	})

let MinimalRootAccount = co
	.account({ profile: UserProfile, root: UserRoot })
	.withMigration((account, creationProps?: { name: string }) => {
		if (!account.$jazz.has("profile")) {
			let profileGroup = Group.create()
			profileGroup.makePublic()
			account.$jazz.set(
				"profile",
				UserProfile.create(
					{ name: creationProps?.name ?? "Minimal" },
					profileGroup,
				),
			)
		}
		if (!account.$jazz.has("root")) {
			account.$jazz.set(
				"root",
				UserRoot.create({
					documents: co.list(Document).create([]),
					migrationVersion: 1,
				}),
			)
		}
	})

let LegacyDocument = co.map({
	version: z.literal(1),
	content: co.plainText(),
	assets: co.optional(co.list(Asset)),
	cursors: co.optional(CursorFeed),
	comments: co.optional(co.list(CommentThread)),
	commentsDisabled: z.boolean().optional(),
	deletedAt: z.date().optional(),
	presentationLine: z.number().optional(),
	highlightRange: HighlightRange.optional(),
	spaceId: z.string().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
})

let LegacySpace = co.map({
	name: z.string(),
	avatar: co.optional(co.image()),
	documents: co.list(LegacyDocument),
	createdAt: z.date(),
	updatedAt: z.date(),
})

let LegacyRoot = co.map({
	documents: co.list(LegacyDocument),
	inactiveDocuments: co.optional(co.list(LegacyDocument)),
	spaces: co.optional(co.list(LegacySpace)),
	settings: co.optional(Settings),
	themes: co.optional(co.list(Theme)),
	language: z.enum(["de", "en"]).optional(),
	migrationVersion: z.number().optional(),
	lastOpenedDocId: z.string().optional(),
	lastOpenedSpaceId: z.string().optional(),
})

let LegacyAccount = co
	.account({ profile: UserProfile, root: LegacyRoot })
	.withMigration((account, creationProps?: { name: string }) => {
		let profileGroup = Group.create()
		profileGroup.makePublic()
		account.$jazz.set(
			"profile",
			UserProfile.create(
				{ name: creationProps?.name ?? "Legacy fixture" },
				profileGroup,
			),
		)
	})

function createLegacyDocument(content: string, owner: Group, spaceId?: string) {
	let now = new Date()
	return LegacyDocument.create(
		{
			version: 1,
			content: co.plainText().create(content, owner),
			spaceId,
			createdAt: now,
			updatedAt: now,
		},
		owner,
	)
}

function createLegacySpace(name: string, contents: string[]) {
	let group = Group.create()
	let now = new Date()
	let space = LegacySpace.create(
		{
			name,
			documents: co.list(LegacyDocument).create([], group),
			createdAt: now,
			updatedAt: now,
		},
		group,
	)

	for (let content of contents) {
		let documentGroup = Group.create()
		documentGroup.addMember(group)
		space.documents.$jazz.push(
			createLegacyDocument(content, documentGroup, space.$jazz.id),
		)
	}

	return space
}

function feedAllChunks(from: CoValueCore, into: LocalNode) {
	let content = from.verified?.newContentSince(undefined)
	if (!content) return
	for (let chunk of content) into.syncManager.handleNewContent(chunk, "import")
}

describe("runAccountMigration - new account creation", () => {
	beforeEach(async () => {
		await setupJazzTestSync()
	})

	test("creates root, welcome document, settings, spaces, themes and profile", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})

		let loaded = await account.$jazz.ensureLoaded({
			resolve: {
				profile: true,
				root: {
					documents: { $each: { content: true } },
					settings: true,
					spaces: true,
					themes: true,
				},
			},
		})

		expect(loaded.root.$isLoaded).toBe(true)
		expect(loaded.root.documents.length).toBe(1)
		expect(loaded.root.documents[0]?.content?.toString()).toContain("Welcome")
		expect(loaded.root.settings?.$isLoaded).toBe(true)
		expect(loaded.root.spaces?.$isLoaded).toBe(true)
		expect(loaded.root.themes?.$isLoaded).toBe(true)
		expect(loaded.profile.name.length).toBeGreaterThan(0)
	})
})

describe("runAccountMigration - idempotency on a fully loaded account", () => {
	beforeEach(async () => {
		await setupJazzTestSync()
	})

	test("re-running the migration replaces no pointers", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})

		let before = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true, spaces: true } },
		})
		let rootIdBefore = before.root.$jazz.id
		let documentsIdBefore = before.root.documents.$jazz.id
		let spacesIdBefore = before.root.spaces?.$jazz.id

		await runAccountMigration(account)

		let after = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true, spaces: true } },
		})
		expect(after.root.$jazz.id).toBe(rootIdBefore)
		expect(after.root.documents.$jazz.id).toBe(documentsIdBefore)
		expect(after.root.spaces?.$jazz.id).toBe(spacesIdBefore)
	})

	test("a login-shaped run never creates a new root or overwrites pointers", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})

		let before = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true, spaces: true } },
		})
		let rootPointerBefore = account.$jazz.raw.get("root")
		let documentsIdBefore = before.root.documents.$jazz.id
		let spacesIdBefore = before.root.spaces?.$jazz.id

		await runAccountMigration(account, undefined)

		expect(account.$jazz.raw.get("root")).toBe(rootPointerBefore)
		let after = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true, spaces: true } },
		})
		expect(after.root.documents.$jazz.id).toBe(documentsIdBefore)
		expect(after.root.spaces?.$jazz.id).toBe(spacesIdBefore)
	})

	test("rotates unbounded root history into a bounded replay snapshot", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		let before = await account.$jazz.ensureLoaded({
			resolve: {
				root: {
					documents: true,
					inactiveDocuments: true,
					spaces: true,
					settings: true,
					themes: true,
				},
			},
		})
		let oldRoot = before.root
		let documentsId = oldRoot.documents.$jazz.id
		let inactiveDocumentsId = oldRoot.inactiveDocuments?.$jazz.id
		let spacesId = oldRoot.spaces?.$jazz.id
		let settingsId = oldRoot.settings?.$jazz.id
		let themesId = oldRoot.themes?.$jazz.id
		let ownerId = oldRoot.$jazz.owner.$jazz.id

		for (let index = 0; index < 1_000; index++) {
			oldRoot.$jazz.set("lastOpenedDocId", `document-${index}`)
		}
		oldRoot.$jazz.set("language", "de")
		oldRoot.$jazz.set("migrationVersion", 1)
		let oldReplaySize =
			oldRoot.$jazz.raw.core.getValidSortedTransactions().length

		await runAccountMigration(account)

		let after = await account.$jazz.ensureLoaded({
			resolve: {
				root: {
					documents: true,
					inactiveDocuments: true,
					spaces: true,
					settings: true,
					themes: true,
				},
			},
		})
		let newReplaySize =
			after.root.$jazz.raw.core.getValidSortedTransactions().length
		expect(oldReplaySize).toBeGreaterThan(1_000)
		expect(after.root.$jazz.id).not.toBe(oldRoot.$jazz.id)
		expect(after.root.$jazz.owner.$jazz.id).toBe(ownerId)
		expect(after.root.documents.$jazz.id).toBe(documentsId)
		expect(after.root.inactiveDocuments?.$jazz.id).toBe(inactiveDocumentsId)
		expect(after.root.spaces?.$jazz.id).toBe(spacesId)
		expect(after.root.settings?.$jazz.id).toBe(settingsId)
		expect(after.root.themes?.$jazz.id).toBe(themesId)
		expect(after.root.language).toBe("de")
		expect(after.root.migrationVersion).toBe(2)
		expect(newReplaySize).toBeLessThanOrEqual(2)
		expect(readLastOpenedDocument(account.$jazz.id)).toEqual({
			documentId: "document-999",
		})
		clearLastOpenedDocument(account.$jazz.id)
	})

	test("recompacts a current root that exceeds the replay budget", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		let before = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true, spaces: true } },
		})
		let oldRoot = before.root
		let documentsId = oldRoot.documents.$jazz.id
		let spacesId = oldRoot.spaces?.$jazz.id

		for (let index = 0; index < 1_000; index++) {
			oldRoot.$jazz.set("lastOpenedDocId", `stale-client-${index}`)
		}
		expect(oldRoot.migrationVersion).toBe(2)
		expect(
			oldRoot.$jazz.raw.core.getValidSortedTransactions().length,
		).toBeGreaterThan(1_000)

		await runAccountMigration(account)

		let after = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true, spaces: true } },
		})
		expect(after.root.$jazz.id).not.toBe(oldRoot.$jazz.id)
		expect(after.root.documents.$jazz.id).toBe(documentsId)
		expect(after.root.spaces?.$jazz.id).toBe(spacesId)
		expect(after.root.migrationVersion).toBe(2)
		expect(
			after.root.$jazz.raw.core.getValidSortedTransactions().length,
		).toBeLessThanOrEqual(2)
		clearLastOpenedDocument(account.$jazz.id)
	})

	test("seeds device-local navigation from a current root", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		let { root } = await account.$jazz.ensureLoaded({ resolve: { root: true } })
		let rootId = root.$jazz.id
		root.$jazz.set("lastOpenedDocId", "synced-document")
		root.$jazz.set("lastOpenedSpaceId", "synced-space")

		await runAccountMigration(account)

		expect(account.$jazz.raw.get("root")).toBe(rootId)
		expect(readLastOpenedDocument(account.$jazz.id)).toEqual({
			documentId: "synced-document",
			spaceId: "synced-space",
		})
		clearLastOpenedDocument(account.$jazz.id)
	})

	test("keeps newer device-local navigation while compacting", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		let { root } = await account.$jazz.ensureLoaded({ resolve: { root: true } })
		root.$jazz.set("lastOpenedDocId", "legacy-document")
		root.$jazz.set("migrationVersion", 1)
		writeLastOpenedDocument(account.$jazz.id, "device-document")

		await runAccountMigration(account)

		expect(readLastOpenedDocument(account.$jazz.id)).toEqual({
			documentId: "device-document",
		})
		clearLastOpenedDocument(account.$jazz.id)
	})
})

describe("runAccountMigration - guarded backfill of missing keys", () => {
	beforeEach(async () => {
		await setupJazzTestSync()
	})

	test("adds missing optional collections on a fully downloaded existing account", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: MinimalRootAccount,
		})

		let { root: before } = await account.$jazz.ensureLoaded({
			resolve: { root: true },
		})
		expect(before.$jazz.has("spaces")).toBe(false)
		expect(before.$jazz.has("settings")).toBe(false)
		expect(before.$jazz.has("themes")).toBe(false)

		let migrationAccount = UserAccount.getMe()
		await runAccountMigration(migrationAccount)

		let { root: after } = await migrationAccount.$jazz.ensureLoaded({
			resolve: { root: { spaces: true, settings: true, themes: true } },
		})
		expect(after.spaces?.$isLoaded).toBe(true)
		expect(after.settings?.$isLoaded).toBe(true)
		expect(after.themes?.$isLoaded).toBe(true)
	})
})

describe("runAccountMigration - previous document schema", () => {
	beforeEach(async () => {
		await setupJazzTestSync()
	})

	test("preserves several personal and space documents and supports lazy metadata backfill", async () => {
		let legacyAccount = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: LegacyAccount,
		})
		let personalContents = [
			"# Personal one\n\nBody",
			"",
			"---\ntags: launch, performance\n---\n\n## Personal three",
		]
		let personalDocuments = personalContents.map(content => {
			let group = Group.create()
			return createLegacyDocument(content, group)
		})
		let spaces = [
			createLegacySpace("Product", [
				"---\ntitle: Product plan\npinned: true\n---\n\nBody",
				"# Product notes",
			]),
			createLegacySpace("Research", ["", "# Research findings"]),
		]
		let legacyRoot = LegacyRoot.create(
			{
				documents: co
					.list(LegacyDocument)
					.create(personalDocuments, legacyAccount),
				spaces: co.list(LegacySpace).create(spaces, legacyAccount),
				migrationVersion: 1,
				lastOpenedDocId: personalDocuments[0].$jazz.id,
			},
			legacyAccount,
		)
		legacyAccount.$jazz.set("root", legacyRoot)

		await legacyAccount.$jazz.waitForAllCoValuesSync()

		let expectedDocumentIds = personalDocuments.map(
			document => document.$jazz.id,
		)
		for (let space of spaces) {
			for (let document of space.documents) {
				if (document) expectedDocumentIds.push(document.$jazz.id)
			}
		}
		let spacesId = legacyRoot.spaces?.$jazz.id
		let crypto = await TestJSCrypto.create()
		let sourceNode = legacyAccount.$jazz.localNode
		let freshNode = new LocalNode(
			sourceNode.getCurrentAgent().agentSecret,
			crypto.newRandomSessionID(legacyAccount.$jazz.raw.id),
			crypto,
		)
		feedAllChunks(legacyAccount.$jazz.raw.core, freshNode)
		feedAllChunks(legacyAccount.profile.$jazz.owner.$jazz.raw.core, freshNode)
		feedAllChunks(legacyAccount.profile.$jazz.raw.core, freshNode)
		feedAllChunks(legacyRoot.$jazz.raw.core, freshNode)
		feedAllChunks(legacyRoot.documents.$jazz.raw.core, freshNode)
		if (legacyRoot.spaces) {
			feedAllChunks(legacyRoot.spaces.$jazz.raw.core, freshNode)
		}

		let currentAgent = UserAccount.getCoValueClass().fromNode(freshNode)
		setActiveAccount(currentAgent)
		let currentAccount = await UserAccount.load(legacyAccount.$jazz.id, {
			loadAs: currentAgent,
			resolve: { profile: true, root: true },
		})
		if (!currentAccount.$isLoaded) {
			throw new Error("account failed to load with the current schema")
		}
		setActiveAccount(currentAccount)

		await runAccountMigration(currentAccount)
		for (let core of sourceNode.allCoValues()) {
			feedAllChunks(core, freshNode)
		}

		let { root } = await currentAccount.$jazz.ensureLoaded({
			resolve: {
				root: {
					documents: { $each: { content: true } },
					inactiveDocuments: true,
					spaces: {
						$each: { documents: { $each: { content: true } } },
					},
					settings: true,
					themes: true,
				},
			},
		})
		if (!root.spaces) throw new Error("spaces failed to load")

		expect(root.$jazz.id).not.toBe(legacyRoot.$jazz.id)
		expect(root.migrationVersion).toBe(2)
		expect(root.spaces.$jazz.id).toBe(spacesId)
		expect(root.spaces.map(space => space?.name)).toEqual([
			"Product",
			"Research",
		])
		expect(root.documents.map(document => document?.$jazz.id)).toEqual(
			personalDocuments.map(document => document.$jazz.id),
		)
		expect(
			root.spaces.map(space =>
				space?.documents.map(document => document?.$jazz.id),
			),
		).toEqual(
			spaces.map(space => space.documents.map(document => document?.$jazz.id)),
		)
		expect(root.lastOpenedDocId).toBe(personalDocuments[0].$jazz.id)
		expect(root.inactiveDocuments?.$isLoaded).toBe(true)
		expect(root.settings?.$isLoaded).toBe(true)
		expect(root.themes?.$isLoaded).toBe(true)

		let loadedDocuments = await Promise.all(
			expectedDocumentIds.map(async documentId => {
				let document = await Document.load(documentId, {
					loadAs: currentAccount,
					resolve: { content: true },
				})
				if (!document.$isLoaded) throw new Error("document failed to load")
				return document
			}),
		)
		expect(loadedDocuments.map(document => document.$jazz.id)).toEqual(
			expectedDocumentIds,
		)
		expect(
			loadedDocuments.map(document => document.content.toString()),
		).toEqual([
			...personalContents,
			"---\ntitle: Product plan\npinned: true\n---\n\nBody",
			"# Product notes",
			"",
			"# Research findings",
		])
		expect(loadedDocuments.every(needsMetadataBackfill)).toBe(true)

		for (let document of loadedDocuments) {
			backfillDocumentMetadata(document)
		}

		expect(loadedDocuments.map(document => document.title)).toEqual([
			"Personal one",
			"Untitled",
			"Personal three",
			"Product plan",
			"Product notes",
			"Untitled",
			"Research findings",
		])
		expect(
			loadedDocuments.every(document => !needsMetadataBackfill(document)),
		).toBe(true)
		expect(loadedDocuments[2].tags).toEqual(["launch", "performance"])
		expect(loadedDocuments[3].pinned).toBe(true)
	})
})

// Push a transaction larger than the recommended size into a CoMap so cojson
// records an intermediate signature after it. Transactions made afterwards
// land in a separate syncable piece that can be withheld, leaving the CoMap
// available but still streaming - with the later-set keys reported as missing.
function bloatCoMap(core: CoValueCore) {
	let oversizedValue = "x".repeat(200 * 1024)
	core.makeTransaction(
		[{ op: "set", key: "streamingFiller", value: oversizedValue }],
		"trusting",
	)
}

async function buildAccountWithRealRoot(
	options: { withOptionalCollections: boolean } = {
		withOptionalCollections: true,
	},
) {
	let account = await createJazzTestAccount({
		isCurrentActiveAccount: true,
		AccountSchema: BareAccount,
	})

	let doc = Document.create(
		{
			version: 1,
			content: co.plainText().create("real content", account),
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		account,
	)
	let realRoot = UserRoot.create(
		{
			documents: co.list(Document).create([doc], account),
			migrationVersion: 1,
		},
		account,
	)
	if (options.withOptionalCollections) {
		realRoot.$jazz.set("spaces", co.list(Space).create([], account))
		realRoot.$jazz.set("themes", co.list(Theme).create([], account))
	}

	bloatCoMap(account.$jazz.raw.core)
	account.$jazz.set("root", realRoot)
	await account.$jazz.waitForAllCoValuesSync()

	return { account, realRoot }
}

// Rebuilds the account on a fresh node (same agent secret, new session, like a
// login on a new device) with the given CoValue's final content piece withheld,
// so that CoValue is available but still streaming when the migration runs.
async function loadOnNodeStreaming(
	account: co.loaded<typeof BareAccount>,
	streamingCore: CoValueCore,
) {
	let crypto = await TestJSCrypto.create()
	let rawAccountId = account.$jazz.raw.id
	let agentSecret = account.$jazz.localNode.getCurrentAgent().agentSecret
	let freshNode = new LocalNode(
		agentSecret,
		crypto.newRandomSessionID(rawAccountId),
		crypto,
	)

	let sourceNode = account.$jazz.localNode
	for (let core of sourceNode.allCoValues()) {
		if (core.id === streamingCore.id) continue
		feedAllChunks(core, freshNode)
	}

	let streamingContent = streamingCore.verified?.newContentSince(undefined)
	if (!streamingContent) throw new Error("no content to stream")
	let withheldChunk = streamingContent[streamingContent.length - 1]
	for (let chunk of streamingContent.slice(0, -1)) {
		freshNode.syncManager.handleNewContent(chunk, "import")
	}

	let controlledAccount = BareAccount.getCoValueClass().fromNode(freshNode)
	setActiveAccount(controlledAccount)

	return {
		freshNode,
		rawAccountId,
		chunkCount: streamingContent.length,
		withheldChunk,
	}
}

// Pins the original incident: signing into an existing account on a fresh
// device runs the migration against a streaming account where has("root") is
// false, and the pre-fix migration created a fresh empty root that replaced
// the real one everywhere. Protection comes from the creationProps split - a
// login-shaped run has no root-creation path at all.
describe("runAccountMigration - account streaming data loss (regression)", () => {
	beforeEach(async () => {
		setMigrationFullDownloadTimeout(500)
		await setupJazzTestSync()
	})

	afterEach(() => {
		setMigrationFullDownloadTimeout(10_000)
	})

	test("compacts only after a streaming account finishes", async () => {
		let { account, realRoot } = await buildAccountWithRealRoot()
		let { freshNode, rawAccountId, chunkCount, withheldChunk } =
			await loadOnNodeStreaming(account, account.$jazz.raw.core)

		expect(chunkCount).toBeGreaterThan(1)

		let accountCore = freshNode.getCoValue(rawAccountId)
		expect(accountCore.isAvailable()).toBe(true)
		expect(accountCore.isStreaming()).toBe(true)
		expect(accountCore.isCompletelyDownloaded()).toBe(false)

		let migrationAccount = UserAccount.getMe()
		expect(migrationAccount.$jazz.has("profile")).toBe(true)
		expect(migrationAccount.$jazz.has("root")).toBe(false)

		setTimeout(() => {
			freshNode.syncManager.handleNewContent(withheldChunk, "import")
		}, 50)

		await runAccountMigration(migrationAccount)

		let { root } = await migrationAccount.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		expect(root.$jazz.id).not.toBe(realRoot.$jazz.id)
		expect(root.documents.$jazz.id).toBe(realRoot.documents.$jazz.id)
		expect(root.migrationVersion).toBe(2)
	})

	test("writes nothing when the account never finishes streaming", async () => {
		let { account } = await buildAccountWithRealRoot()
		await loadOnNodeStreaming(account, account.$jazz.raw.core)

		let migrationAccount = UserAccount.getMe()
		expect(migrationAccount.$jazz.has("root")).toBe(false)

		await runAccountMigration(migrationAccount)

		expect(migrationAccount.$jazz.raw.get("root")).toBeUndefined()
	})

	// Pins the account-level isFullyDownloaded gate: without it, has("root") on
	// the still-streaming account reads false and the migration returns before
	// backfilling, silently skipping the missing collections on this login.
	test("backfills missing collections once the account finishes streaming", async () => {
		let { account } = await buildAccountWithRealRoot({
			withOptionalCollections: false,
		})
		let { freshNode, withheldChunk } = await loadOnNodeStreaming(
			account,
			account.$jazz.raw.core,
		)

		let migrationAccount = UserAccount.getMe()
		expect(migrationAccount.$jazz.has("root")).toBe(false)

		setTimeout(() => {
			freshNode.syncManager.handleNewContent(withheldChunk, "import")
		}, 50)

		await runAccountMigration(migrationAccount)

		let { root } = await migrationAccount.$jazz.ensureLoaded({
			resolve: { root: { spaces: true, settings: true, themes: true } },
		})
		expect(root.spaces?.$isLoaded).toBe(true)
		expect(root.settings?.$isLoaded).toBe(true)
		expect(root.themes?.$isLoaded).toBe(true)
	})
})

async function buildAccountWithStreamingRoot() {
	let account = await createJazzTestAccount({
		isCurrentActiveAccount: true,
		AccountSchema: BareAccount,
	})

	let doc = Document.create(
		{
			version: 1,
			content: co.plainText().create("real content", account),
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		account,
	)
	let realRoot = UserRoot.create(
		{
			documents: co.list(Document).create([doc], account),
			migrationVersion: 1,
		},
		account,
	)

	bloatCoMap(realRoot.$jazz.raw.core)
	let realSpaces = co.list(Space).create([], account)
	let realThemes = co.list(Theme).create([], account)
	realRoot.$jazz.set("spaces", realSpaces)
	realRoot.$jazz.set("themes", realThemes)

	account.$jazz.set("root", realRoot)
	await account.$jazz.waitForAllCoValuesSync()

	return { account, realRoot, realSpaces, realThemes }
}

describe("runAccountMigration - root streaming data loss (regression)", () => {
	beforeEach(async () => {
		setMigrationFullDownloadTimeout(500)
		await setupJazzTestSync()
	})

	afterEach(() => {
		setMigrationFullDownloadTimeout(10_000)
	})

	test("waits for the root to finish streaming instead of backfilling collections that exist", async () => {
		let { account, realRoot, realSpaces, realThemes } =
			await buildAccountWithStreamingRoot()
		let { freshNode, rawAccountId, chunkCount, withheldChunk } =
			await loadOnNodeStreaming(account, realRoot.$jazz.raw.core)

		expect(chunkCount).toBeGreaterThan(1)
		expect(freshNode.getCoValue(rawAccountId).isCompletelyDownloaded()).toBe(
			true,
		)

		let rootCore = freshNode.getCoValue(realRoot.$jazz.raw.id)
		expect(rootCore.isAvailable()).toBe(true)
		expect(rootCore.isStreaming()).toBe(true)
		expect(rootCore.isCompletelyDownloaded()).toBe(false)

		let migrationAccount = UserAccount.getMe()
		expect(migrationAccount.$jazz.has("root")).toBe(true)

		setTimeout(() => {
			freshNode.syncManager.handleNewContent(withheldChunk, "import")
		}, 50)

		await runAccountMigration(migrationAccount)

		let { root } = await migrationAccount.$jazz.ensureLoaded({
			resolve: { root: true },
		})
		expect(root.$jazz.raw.get("spaces")).toBe(realSpaces.$jazz.id)
		expect(root.$jazz.raw.get("themes")).toBe(realThemes.$jazz.id)
	})

	test("writes nothing when the root never finishes streaming", async () => {
		let { account, realRoot, realSpaces, realThemes } =
			await buildAccountWithStreamingRoot()
		let { freshNode, withheldChunk } = await loadOnNodeStreaming(
			account,
			realRoot.$jazz.raw.core,
		)

		let migrationAccount = UserAccount.getMe()
		await runAccountMigration(migrationAccount)

		// Deliver the remaining chunk only after the migration gave up. Had the
		// migration written fresh empty lists against the partial root, those
		// writes would be newer and win last-writer-wins over the real pointers.
		freshNode.syncManager.handleNewContent(withheldChunk, "import")

		let { root } = await migrationAccount.$jazz.ensureLoaded({
			resolve: { root: true },
		})
		expect(root.$jazz.raw.get("spaces")).toBe(realSpaces.$jazz.id)
		expect(root.$jazz.raw.get("themes")).toBe(realThemes.$jazz.id)
	})
})
