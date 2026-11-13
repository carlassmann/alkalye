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
import { stableId } from "./conversion"
let state: { jazz?: Jazz; role: "reader" | "admin" } = vi.hoisted(() => ({
	role: "admin",
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
		readClassicAccess: async (_id: string, accountId: string) => ({
			role: state.role,
			ownerClassicId: accountId,
			publicRead: false,
			members: [{ id: accountId, role: state.role }],
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
		versions: [],
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
