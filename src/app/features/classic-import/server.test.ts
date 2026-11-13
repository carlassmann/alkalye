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
	role: "reader" | "admin"
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
		readClassicAccess: async (id: string, accountId: string) => ({
			groupId: id === state.foreignGroupFor ? "foreign" : "source",
			groupIds: [id === state.foreignGroupFor ? "foreign" : "source"],
			createdBy: state.authors[id] ?? accountId,
			role: state.role,
			ownerClassicId: accountId,
			publicRead: false,
			members: [{ id: accountId, role: state.role }],
			directMembers: [{ id: accountId, role: state.role }],
		}),
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
		offset += 524288, part++
	) {
		let chunk = {
			challengeId,
			uploadId: packed.sha256,
			part,
			base64: packed.base64.slice(offset, offset + 524288),
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
		uploadId: packed.sha256,
		part: 0,
		base64: packed.base64.slice(0, 524288),
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
