// @vitest-environment node
import { beforeAll, afterAll, expect, test, vi } from "vitest"
import {
	createJazz,
	memory,
	acceptDeviceAccounts,
	type Jazz,
} from "jazz-tools/backend"
import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { cojsonInternals } from "cojson"
import { app } from "@/jazz/schema"
import { permissions } from "@/jazz/permissions"
import { stableId, packBytes } from "./conversion"
let state: {
	jazz?: Jazz
	role: "reader" | "writer" | "admin"
	removed?: string
	extraMember?: string
	authors: Record<string, string>
	foreignGroupFor?: string
} = vi.hoisted(() => ({
	role: "admin",
	authors: {},
}))
vi.mock("@/jazz/server", () => ({
	get jazz() {
		return state.jazz
	},
}))
vi.mock("./verification", async importOriginal => {
	let original = await importOriginal<typeof import("./verification")>()
	return {
		...original,
		readClassicAccess: async (id: string, accountId: string) => {
			if (accountId === state.removed)
				throw new Error("Classic read access denied")
			return {
				groupId: id === state.foreignGroupFor ? "foreign" : "source",
				groupIds: [id === state.foreignGroupFor ? "foreign" : "source"],
				createdBy: state.authors[id] ?? accountId,
				role: state.role,
				ownerClassicId: accountId,
				publicRead: false,
				members: [
					{ id: accountId, role: state.role },
					...(state.extraMember
						? [{ id: state.extraMember, role: "reader" }]
						: []),
				],
				directMembers: [{ id: accountId, role: state.role }],
			}
		},
	}
})
let accountId = "00000000-0000-4000-8000-000000000001"
let classicId: string
let challengeId: string
beforeAll(async () => {
	state.jazz = await createJazz({
		app,
		permissions,
		store: memory(),
		authenticate: acceptDeviceAccounts,
	}).ready()
	let crypto = await WasmCrypto.create()
	let secret = crypto.agentSecretFromSecretSeed(new Uint8Array(32).fill(23))
	classicId = cojsonInternals.idforHeader(
		cojsonInternals.accountHeaderForInitialAgentSecret(secret, crypto),
		crypto,
	)
	let { challenge, claimClassicAccount } = await import("./server")
	let issued = await challenge(accountId)
	challengeId = issued.challengeId
	let proof = {
		classicId,
		challengeId,
		agentId: crypto.getAgentID(secret),
		signature: crypto.sign(crypto.getAgentSignerSecret(secret), {
			nonce: issued.nonce,
			accountId,
		}),
	}
	await expect(
		claimClassicAccount("00000000-0000-4000-8000-000000000002", proof),
	).rejects.toThrow()
	await claimClassicAccount(accountId, proof)
})
afterAll(async () => {
	await state.jazz?.close()
})
test("imports once, resumes failed items, and three-way merges late Classic edits", async () => {
	let { importClassicItem } = await import("./server")
	let item = {
		kind: "document",
		classicId: "co_z123",
		content: "# Original\n\nMiddle\n\nEnd",
		title: "Original",
		tags: [],
		pinned: true,
		path: "Work/Notes",
		archived: false,
		isPresentation: false,
		commentsDisabled: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		versions: [
			{
				classicId: "shared-text:session:0",
				content: "Original past",
				authorId: classicId,
				createdAt: new Date(0),
			},
		],
		comments: [],
		assets: [],
	}
	let input = { challengeId, item }
	let first = await importClassicItem(accountId, input)
	await importClassicItem(accountId, input)
	expect(await state.jazz!.db.all(app.documents)).toHaveLength(1)
	expect(await state.jazz!.db.all(app.userDocuments)).toHaveLength(1)
	expect(await state.jazz!.db.all(app.folders)).toHaveLength(2)
	expect(
		(await state.jazz!.db.one(app.documents.where({ id: first.id })))?.ownerId,
	).toBe(accountId)
	let importedGrant = await state.jazz!.db.one(
		app.documentGrants.where({ documentId: first.id, accountId }),
	)
	if (!importedGrant) throw new Error("Imported grant missing")
	expect(importedGrant.inviteId).toBeNull()
	let summary = await state.jazz!.db.one(
		app.documents
			.where({ id: first.id })
			.select("title", "tags", "path", "frontmatterPinned"),
	)
	expect(summary).toMatchObject({
		title: "Original",
		tags: [],
		path: "Work/Notes",
		frontmatterPinned: true,
	})
	expect(summary).not.toHaveProperty("content")
	await state
		.jazz!.db.update(app.documentGrants, importedGrant.id, { role: "reader" })
		.wait({ tier: "global" })
	await importClassicItem(accountId, input)
	expect(
		(
			await state.jazz!.db.one(
				app.documentGrants.where({ id: importedGrant.id }),
			)
		)?.role,
	).toBe("reader")
	await state
		.jazz!.db.delete(app.documentGrants, importedGrant.id)
		.wait({ tier: "global" })
	await importClassicItem(accountId, input)
	expect(
		await state.jazz!.db.one(
			app.documentGrants.where({ id: importedGrant.id }),
		),
	).toBeNull()

	let base = item.content
	await state
		.jazz!.db.transaction(tx =>
			tx.update(
				app.documents,
				first.id,
				{ content: base + "\n\nV2 edit" },
				{ editedFrom: { content: base } },
			),
		)
		.then(write => write.wait({ tier: "global" }))
	await importClassicItem(accountId, {
		challengeId,
		item: { ...item, content: "Classic offline edit\n" + base },
	})
	let result = await state.jazz!.db.one(app.documents.where({ id: first.id }))
	expect(result?.content).toContain("V2 edit")
	expect(result?.content).toContain("Classic offline edit")
	expect(result?.title).toBe("Classic offline edit")
	expect(result?.frontmatterPinned).toBe(false)
	await importClassicItem(accountId, {
		challengeId,
		item: { ...item, classicId: "co_z12B" },
	})
	expect(await state.jazz!.db.all(app.documentVersions)).toHaveLength(2)
	expect(
		new Set(
			(await state.jazz!.db.all(app.documentVersions)).map(
				version => version.documentId,
			),
		).size,
	).toBe(2)

	let failed = {
		...item,
		classicId: "co_z124",
		assets: [
			{
				classicId: "co_z125",
				type: "image",
				name: "bad",
				createdAt: new Date(),
				revisions: [],
				data: { base64: btoa("x"), sha256: "0".repeat(64) },
			},
		],
	}
	await expect(
		importClassicItem(accountId, { challengeId, item: failed }),
	).rejects.toThrow("checksum")
	expect(
		(
			await state.jazz!.db.one(
				app.classicImports.where({ id: await stableId("map:co_z124") }),
			)
		)?.status,
	).toBe("failed")
	await importClassicItem(accountId, {
		challengeId,
		item: { ...failed, assets: [] },
	})
	expect(
		(
			await state.jazz!.db.one(
				app.classicImports.where({ id: await stableId("map:co_z124") }),
			)
		)?.status,
	).toBe("complete")
	await state
		.jazz!.db.update(app.documents, first.id, {
			ownerId: "00000000-0000-4000-8000-000000000004",
		})
		.wait({ tier: "global" })
	for (let retry = 0; retry < 2; retry++)
		await expect(
			importClassicItem(accountId, {
				challengeId,
				item: { ...item, content: "Revoked writer payload" },
			}),
		).rejects.toThrow()
	expect(
		(await state.jazz!.db.one(app.documents.where({ id: first.id })))?.content,
	).not.toBe("Revoked writer payload")
})
test("large binary chunks resume without duplication and are removed after a verified import", async () => {
	let { uploadChunk, importClassicItem } = await import("./server")
	let { packBytes } = await import("./conversion")
	let bytes = new Uint8Array(900000).fill(37)
	let packed = await packBytes(bytes)
	for (
		let offset = 0, part = 0;
		offset < packed.base64.length;
		offset += 65536, part++
	) {
		let chunk = {
			challengeId,
			classicId: "co_z126",
			kind: "document",
			byteLength: bytes.length,
			uploadId: packed.sha256,
			part,
			base64: packed.base64.slice(offset, offset + 65536),
		}
		await uploadChunk(accountId, chunk)
		await uploadChunk(accountId, chunk)
	}
	let item = {
		kind: "document",
		classicId: "co_z126",
		content: "# Video",
		title: "Video",
		tags: [],
		pinned: false,
		archived: false,
		isPresentation: false,
		commentsDisabled: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		versions: [],
		comments: [],
		assets: [
			{
				classicId: "co_z127",
				type: "video",
				name: "clip",
				createdAt: new Date(),
				revisions: [],
				data: { sha256: packed.sha256, uploadId: packed.sha256 },
			},
		],
	}
	await importClassicItem(accountId, { challengeId, item })
	expect(
		(
			await state.jazz!.db.one(
				app.assets.where({ id: await stableId("co_z127") }),
			)
		)?.data,
	).toEqual(bytes)
	expect(await state.jazz!.db.all(app.classicImportChunks)).toHaveLength(0)
	await uploadChunk(accountId, {
		challengeId,
		classicId: "co_z126",
		kind: "document",
		byteLength: bytes.length,
		uploadId: packed.sha256,
		part: 0,
		base64: packed.base64.slice(0, 65536),
	})
	expect(await state.jazz!.db.all(app.classicImportChunks)).toHaveLength(1)
})
test("a later verified author claim recovers imported comment ownership", async () => {
	let { challenge, claimClassicAccount, importClassicItem } =
		await import("./server")
	let crypto = await WasmCrypto.create()
	let secret = crypto.agentSecretFromSecretSeed(new Uint8Array(32).fill(94))
	let classicAuthor = cojsonInternals.idforHeader(
		cojsonInternals.accountHeaderForInitialAgentSecret(secret, crypto),
		crypto,
	)
	let otherAccount = "00000000-0000-4000-8000-000000000003"
	state.authors["co_z129"] = classicAuthor
	state.authors["co_z12A"] = classicAuthor
	let now = new Date()
	let item = {
		kind: "document",
		classicId: "co_z128",
		content: "Quoted text",
		title: "Comments",
		tags: [],
		pinned: false,
		archived: false,
		isPresentation: false,
		commentsDisabled: false,
		createdAt: now,
		updatedAt: now,
		versions: [],
		assets: [],
		comments: [
			{
				classicId: "co_z129",
				authorId: classicAuthor,
				anchor: {
					quote: "Quoted",
					contextBefore: "",
					contextAfter: " text",
					start: 0,
					end: 6,
				},
				createdAt: now,
				updatedAt: now,
				replies: [
					{
						classicId: "co_z12A",
						authorId: classicAuthor,
						body: "Original author's reply",
						createdAt: now,
					},
				],
			},
		],
	}
	await importClassicItem(accountId, { challengeId, item })
	expect(
		(
			await state.jazz!.db.one(
				app.commentThreads.where({ id: await stableId("co_z129") }),
			)
		)?.authorId,
	).toBe(await stableId(`author:${classicAuthor}`))
	let issued = await challenge(otherAccount)
	await claimClassicAccount(otherAccount, {
		challengeId: issued.challengeId,
		classicId: classicAuthor,
		agentId: crypto.getAgentID(secret),
		signature: crypto.sign(crypto.getAgentSignerSecret(secret), {
			nonce: issued.nonce,
			accountId: otherAccount,
		}),
	})
	expect(
		(
			await state.jazz!.db.one(
				app.commentThreads.where({ id: await stableId("co_z129") }),
			)
		)?.authorId,
	).toBe(otherAccount)
	expect(
		(
			await state.jazz!.db.one(
				app.commentReplies.where({ id: await stableId("co_z12A") }),
			)
		)?.authorId,
	).toBe(otherAccount)
})
test("v2 space revocation survives replay and space links require signed group ancestry", async () => {
	let { importClassicItem } = await import("./server")
	let space = {
		kind: "space",
		classicId: "co_z12C",
		name: "Space",
		createdAt: new Date(),
		updatedAt: new Date(),
	}
	let result = await importClassicItem(accountId, { challengeId, item: space })
	let member = await state.jazz!.db.one(
		app.spaceMembers.where({ spaceId: result.id, accountId }),
	)
	if (!member) throw new Error("Space member missing")
	await state
		.jazz!.db.update(app.spaceMembers, member.id, { role: "reader" })
		.wait({ tier: "global" })
	await importClassicItem(accountId, { challengeId, item: space })
	expect(
		(await state.jazz!.db.one(app.spaceMembers.where({ id: member.id })))?.role,
	).toBe("reader")
	await state
		.jazz!.db.delete(app.spaceMembers, member.id)
		.wait({ tier: "global" })
	await importClassicItem(accountId, { challengeId, item: space })
	expect(
		await state.jazz!.db.one(app.spaceMembers.where({ id: member.id })),
	).toBeNull()
	state.foreignGroupFor = "co_z12D"
	let doc = {
		kind: "document",
		classicId: "co_z12D",
		spaceId: space.classicId,
		content: "private",
		title: "Private",
		tags: [],
		pinned: false,
		archived: false,
		isPresentation: false,
		commentsDisabled: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		versions: [],
		comments: [],
		assets: [],
	}
	await expect(
		importClassicItem(accountId, { challengeId, item: doc }),
	).rejects.toThrow("does not belong")
	state.foreignGroupFor = undefined
	let imported = await importClassicItem(accountId, { challengeId, item: doc })
	expect(
		await state.jazz!.db.all(
			app.documentGrants.where({ documentId: imported.id }),
		),
	).toHaveLength(0)
})
test("preclaimed ids and child rows cannot disclose another v2 document", async () => {
	let { importClassicItem } = await import("./server")
	let otherOwner = "00000000-0000-4000-8000-000000000004"
	let otherDoc = await stableId("co_z12E")
	await state
		.jazz!.db.insert(
			app.documents,
			{
				ownerId: otherOwner,
				title: "Private",
				content: "Existing private bytes",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{ id: otherDoc },
		)
		.wait({ tier: "global" })
	let item = {
		kind: "document",
		classicId: "co_z12E",
		content: "Incoming Classic private data",
		title: "Classic",
		tags: [],
		pinned: false,
		archived: false,
		isPresentation: false,
		commentsDisabled: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		versions: [],
		comments: [],
		assets: [],
	}
	await expect(
		importClassicItem(accountId, { challengeId, item }),
	).rejects.toThrow("collides")
	expect(
		(await state.jazz!.db.one(app.documents.where({ id: otherDoc })))?.content,
	).toBe("Existing private bytes")
	let assetId = await stableId("co_z12F")
	await state
		.jazz!.db.insert(
			app.assets,
			{
				documentId: otherDoc,
				type: "image",
				name: "Private",
				data: new Uint8Array([11, 22, 33]),
				createdAt: new Date(),
			},
			{ id: assetId },
		)
		.wait({ tier: "global" })
	await expect(
		importClassicItem(accountId, {
			challengeId,
			item: {
				...item,
				classicId: "co_z12G",
				assets: [
					{
						classicId: "co_z12F",
						name: "Hijack",
						type: "image",
						createdAt: new Date(),
						revisions: [],
					},
				],
			},
		}),
	).rejects.toThrow("another document")
	expect(
		(await state.jazz!.db.one(app.assets.where({ id: assetId })))?.documentId,
	).toBe(otherDoc)
	await expect(
		importClassicItem(accountId, {
			challengeId,
			item: {
				kind: "theme",
				classicId: "co_z123",
				name: "Wrong kind",
				type: "both",
				css: "",
				assets: [],
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		}),
	).rejects.toThrow("another kind")
})
test("theme assets retain bytes and references in CSS and templates", async () => {
	let { importClassicItem } = await import("./server")
	let assetId = await stableId("co_z12K")
	let bytes = new Uint8Array([7, 18, 29])
	let result = await importClassicItem(accountId, {
		challengeId,
		item: {
			kind: "theme",
			classicId: "co_z12J",
			name: "Imported theme",
			type: "both",
			css: "body { background-image: url(asset:co_z12K) }",
			template: '<img src="asset:co_z12K">',
			createdAt: new Date(),
			updatedAt: new Date(),
			assets: [
				{
					classicId: "co_z12K",
					name: "pixel",
					mimeType: "image/png",
					data: await packBytes(bytes),
					createdAt: new Date(),
				},
			],
		},
	})
	let theme = await state.jazz!.db.one(app.themes.where({ id: result.id }))
	expect(theme?.css).toContain(`asset:${assetId}`)
	expect(theme?.template).toContain(`asset:${assetId}`)
	expect(
		(await state.jazz!.db.one(app.themeAssets.where({ id: assetId })))?.data,
	).toEqual(bytes)
})
test("imported memberships have no invite provenance and survive v2 invite revocation", async () => {
	let { importClassicItem } = await import("./server")
	let { sharingOperation } = await import("@/jazz/sharing/operations")
	let item = {
		kind: "space",
		classicId: "co_z12L",
		name: "Imported space",
		createdAt: new Date(),
		updatedAt: new Date(),
	}
	let { id: spaceId } = await importClassicItem(accountId, {
		challengeId,
		item,
	})
	let db = state.jazz!.db
	let original = await db.one(app.spaceMembers.where({ spaceId, accountId }))
	expect(original?.inviteId).toBeNull()
	let invitedAccount = "00000000-0000-4000-8000-000000000009"
	let invitation = await sharingOperation(
		state.jazz!,
		accountId,
		"create-invite",
		{ spaceId, role: "writer" },
		"https://app.test",
	)
	if (!invitation.link || !invitation.id) throw new Error("Missing invitation")
	await sharingOperation(
		state.jazz!,
		invitedAccount,
		"redeem",
		{
			inviteId: invitation.id,
			secret: invitation.link.split("/").at(-1),
		},
		"",
	)
	let member = await db.one(
		app.spaceMembers.where({ spaceId, accountId: invitedAccount }),
	)
	expect(member?.role).toBe("writer")
	expect(member?.inviteId).toBe(invitation.id)
	await sharingOperation(
		state.jazz!,
		accountId,
		"revoke",
		{ inviteId: invitation.id },
		"",
	)
	await importClassicItem(accountId, { challengeId, item })
	expect(await db.one(app.spaceMembers.where({ spaceId, accountId }))).toEqual(
		original,
	)
	expect(
		await db.one(
			app.spaceMembers.where({ spaceId, accountId: invitedAccount }),
		),
	).toBeNull()
})
test("readers cannot submit first imports or incomplete retries", async () => {
	let { importClassicItem } = await import("./server")
	let item = documentFixture("co_z13A")
	state.role = "reader"
	try {
		await expect(
			importClassicItem(accountId, { challengeId, item }),
		).rejects.toThrow("Waiting for a Classic owner or editor")
		expect(
			await state.jazz!.db.one(
				app.documents.where({ id: await stableId(item.classicId) }),
			),
		).toBeNull()
		await state
			.jazz!.db.insert(
				app.classicImports,
				{
					ownerId: accountId,
					classicId: item.classicId,
					v2Id: await stableId(item.classicId),
					kind: "document",
					status: "failed",
				},
				{ id: await stableId(`map:${item.classicId}`) },
			)
			.wait({ tier: "global" })
		await expect(
			importClassicItem(accountId, { challengeId, item }),
		).rejects.toThrow("Waiting for a Classic owner or editor")
	} finally {
		state.role = "admin"
	}
})
test("writer-supplied history cannot impersonate another author", async () => {
	let { importClassicItem } = await import("./server")
	let item = {
		...documentFixture("co_z13B"),
		versions: [
			{
				classicId: "forged-history",
				content: "forged",
				authorId: "co_zVictim",
				authorName: "Victim",
				createdAt: new Date(0),
			},
		],
	}
	await importClassicItem(accountId, { challengeId, item })
	let version = await state.jazz!.db.one(
		app.documentVersions.where({ documentId: await stableId(item.classicId) }),
	)
	expect(version?.authorId).toBe(accountId)
	expect(version?.authorName).toBe(`Imported by ${accountId}`)
})
test("stale pending Classic access is reconciled before activation", async () => {
	let { importClassicItem } = await import("./server")
	let item = documentFixture("co_z13C")
	let removed = "co_zRemoved"
	state.extraMember = removed
	await importClassicItem(accountId, { challengeId, item })
	state.extraMember = undefined
	state.removed = removed
	await state
		.jazz!.db.insert(app.classicAccounts, {
			ownerId: "00000000-0000-4000-8000-000000000007",
			classicId: removed,
		})
		.wait({ tier: "global" })
	try {
		await importClassicItem(accountId, { challengeId, item })
		expect(
			await state.jazz!.db.all(
				app.classicAccess.where({
					resourceId: await stableId(item.classicId),
					classicId: removed,
				}),
			),
		).toHaveLength(0)
		expect(
			await state.jazz!.db.all(
				app.documentGrants.where({
					documentId: await stableId(item.classicId),
					accountId: "00000000-0000-4000-8000-000000000007",
				}),
			),
		).toHaveLength(0)
	} finally {
		state.removed = undefined
	}
})
function documentFixture(classicId: string) {
	return {
		kind: "document",
		classicId,
		content: "# Original",
		title: "Original",
		tags: [],
		pinned: false,
		archived: false,
		isPresentation: false,
		commentsDisabled: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		versions: [],
		comments: [],
		assets: [],
	}
}
test("chunk bounds, account quota, reader authority and expiry are enforced", async () => {
	let { uploadChunk, challenge } = await import("./server")
	let base = {
		challengeId,
		classicId: "co_z13D",
		kind: "document",
		byteLength: 512 * 1024 * 1024,
		uploadId: "1".repeat(64),
		part: 0,
		base64: btoa("x".repeat(49152)),
	}
	await expect(
		uploadChunk(accountId, { ...base, byteLength: base.byteLength + 1 }),
	).rejects.toThrow()
	await expect(
		uploadChunk(accountId, {
			...base,
			byteLength: 1,
			part: 1,
			base64: btoa("x"),
		}),
	).rejects.toThrow()
	state.role = "reader"
	try {
		await expect(uploadChunk(accountId, base)).rejects.toThrow(
			"Waiting for a Classic owner or editor",
		)
	} finally {
		state.role = "admin"
	}
	await uploadChunk(accountId, base)
	await expect(
		uploadChunk(accountId, { ...base, uploadId: "2".repeat(64) }),
	).rejects.toThrow("quota")
	// The existing resumable 900KB upload plus one 512MiB reservation exceed the quota with another 512MiB reservation.
	for (let upload of await state.jazz!.db.all(app.classicUploads))
		await state
			.jazz!.db.update(app.classicUploads, upload.id, {
				expiresAt: new Date(0),
			})
			.wait({ tier: "global" })
	await challenge(accountId)
	expect(await state.jazz!.db.all(app.classicImportChunks)).toHaveLength(0)
	expect(await state.jazz!.db.all(app.classicUploads)).toHaveLength(0)
})
test("staged assembly checks identity before reading chunks", async () => {
	let { importStagedItem } = await import("./server")
	let spy = vi.spyOn(state.jazz!.db, "all")
	try {
		await expect(
			importStagedItem(accountId, {
				challengeId: crypto.randomUUID(),
				classicId: "co_z13D",
				kind: "document",
				uploadId: "1".repeat(64),
				sha256: "1".repeat(64),
			}),
		).rejects.toThrow("proof required")
		expect(spy).not.toHaveBeenCalled()
	} finally {
		spy.mockRestore()
	}
})
test("legacy lookups reveal only currently readable imported targets", async () => {
	let { importClassicItem, lookupClassicItem } = await import("./server")
	let item = documentFixture("co_z13E")
	let { id } = await importClassicItem(accountId, { challengeId, item })
	let visitor = "00000000-0000-4000-8000-000000000008"
	expect(
		await lookupClassicItem(visitor, {
			classicId: item.classicId,
			kind: "document",
		}),
	).toEqual({ id: null })
	expect(
		await lookupClassicItem(visitor, {
			classicId: "co_zMissing",
			kind: "document",
		}),
	).toEqual({ id: null })
	await state
		.jazz!.db.update(app.documents, id, { publicRead: true })
		.wait({ tier: "global" })
	expect(
		await lookupClassicItem(visitor, {
			classicId: item.classicId,
			kind: "document",
		}),
	).toEqual({ id })
	await state
		.jazz!.db.update(app.documents, id, { publicRead: false })
		.wait({ tier: "global" })
	expect(
		await lookupClassicItem(visitor, {
			classicId: item.classicId,
			kind: "document",
		}),
	).toEqual({ id: null })
})
test("staged history keeps more than 200 versions and a nine MiB snapshot", async () => {
	let { uploadChunk, importStagedItem } = await import("./server")
	let item = {
		...documentFixture("co_z13F"),
		versions: Array.from({ length: 250 }, (_, index) => ({
			classicId: `full-history:${index}`,
			authorId: classicId,
			content: index === 249 ? "x".repeat(9 * 1024 * 1024) : `version ${index}`,
			createdAt: new Date(index * 60000),
		})),
	}
	let bytes = new TextEncoder().encode(JSON.stringify({ challengeId, item }))
	let packed = await packBytes(bytes)
	for (
		let offset = 0, part = 0;
		offset < packed.base64.length;
		offset += 65536, part++
	)
		await uploadChunk(accountId, {
			challengeId,
			classicId: item.classicId,
			kind: item.kind,
			byteLength: bytes.length,
			uploadId: packed.sha256,
			part,
			base64: packed.base64.slice(offset, offset + 65536),
		})
	await importStagedItem(accountId, {
		challengeId,
		classicId: item.classicId,
		kind: item.kind,
		uploadId: packed.sha256,
		sha256: packed.sha256,
	})
	let versions = await state.jazz!.db.all(
		app.documentVersions.where({ documentId: await stableId(item.classicId) }),
	)
	expect(versions).toHaveLength(250)
	expect(
		versions.find(version => version.classicId === "full-history:249")?.content
			.length,
	).toBe(9 * 1024 * 1024)
	expect(await state.jazz!.db.all(app.classicImportChunks)).toHaveLength(0)
}, 30000)
test("rejects expired and unverified sessions", async () => {
	let { challenge, importClassicItem } = await import("./server")
	let issued = await challenge(accountId)
	await expect(
		importClassicItem(accountId, { challengeId: issued.challengeId, item: {} }),
	).rejects.toThrow("proof required")
	await state
		.jazz!.db.update(app.classicChallenges, challengeId, {
			expiresAt: new Date(0),
		})
		.wait({ tier: "global" })
	await expect(
		importClassicItem(accountId, { challengeId, item: {} }),
	).rejects.toThrow("proof required")
})
