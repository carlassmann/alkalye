import { mnemonicToEntropy } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import { RecoveryPhrase } from "jazz-tools/passphrase"
import { deviceAuthorization } from "@/app/features/agents/lib/agent-api"
import { z } from "zod"
import {
	openClassicAccount,
	readDocument,
	readSpace,
	readTheme,
} from "./reader"
import { stableId, packBytes } from "./conversion"
import { readClassicCredentials } from "./identity"
import type { ImportItem } from "./contract"
export { runClassicImport }
export type { ImportProgress }

type ImportProgress = {
	completed: number
	total: number
	errors: { id: string; message: string }[]
	done: boolean
}
async function runClassicImport(
	key: string,
	progress: (state: ImportProgress) => void,
	signal: AbortSignal,
) {
	return navigator.locks.request("alkalye-classic-import", { signal }, () =>
		importClassicAccount(key, progress, signal),
	)
}
async function importClassicAccount(
	key: string,
	progress: (state: ImportProgress) => void,
	signal: AbortSignal,
) {
	if (
		!import.meta.env.PUBLIC_JAZZ_CLASSIC_SYNC_SERVER &&
		!import.meta.env.PUBLIC_JAZZ_SYNC_SERVER
	)
		return
	let seed = mnemonicToEntropy(RecoveryPhrase.fromSecret(key), wordlist)
	let stored = readClassicCredentials()
	let sameSeed = stored?.secretSeed.every((byte, index) => byte === seed[index])
	let source = await openClassicAccount(
		seed,
		sameSeed ? stored?.accountID : undefined,
	)
	try {
		let state: ImportProgress = {
			completed: 0,
			total: 0,
			errors: [],
			done: false,
		}
		let challenge = z
			.object({
				challengeId: z.string(),
				nonce: z.string(),
				accountId: z.string(),
			})
			.parse(await request("challenge", key, {}))
		let proof = {
			classicId: source.account.$jazz.id,
			challengeId: challenge.challengeId,
			agentId: source.crypto.getAgentID(source.secret),
			signature: source.crypto.sign(
				source.crypto.getAgentSignerSecret(source.secret),
				{ nonce: challenge.nonce, accountId: challenge.accountId },
			),
		}
		await request("claim", key, proof)
		await source.sync()
		let tasks: { id: string; read: () => Promise<ImportItem> }[] = []
		let seen = new Set<string>()
		function add(id: string, read: () => Promise<ImportItem>) {
			if (!seen.has(id)) {
				seen.add(id)
				tasks.push({ id, read })
			}
		}
		for (let theme of source.account.root.themes ?? [])
			add(theme.$jazz.id, () => readTheme(theme))
		for (let space of source.account.root.spaces ?? []) {
			add(space.$jazz.id, () => readSpace(space))
			let loaded = await space.$jazz.ensureLoaded({
				resolve: { documents: { $each: true } },
			})
			for (let doc of loaded.documents)
				add(doc.$jazz.id, () => readDocument(doc, false))
		}
		for (let doc of source.account.root.documents)
			add(doc.$jazz.id, () => readDocument(doc, false))
		for (let doc of source.account.root.inactiveDocuments ?? [])
			add(doc.$jazz.id, () => readDocument(doc, true))
		add(source.account.$jazz.id, async () => source.accountItem())
		state.total = tasks.length
		progress({ ...state })
		for (let task of tasks) {
			if (signal.aborted) return
			try {
				let item = await task.read()
				await uploadLargeBytes(key, challenge.challengeId, item)
				for (let retry = 0; ; retry++) {
					try {
						await request("item", key, {
							challengeId: challenge.challengeId,
							item,
						})
						break
					} catch (error) {
						if (
							retry >= 2 ||
							!(error instanceof Error) ||
							!error.message.includes("object already exists")
						)
							throw error
					}
				}
			} catch (error) {
				state.errors.push({
					id: task.id,
					message: error instanceof Error ? error.message : "Import failed",
				})
			}
			state.completed++
			progress({ ...state, errors: [...state.errors] })
		}
		progress({ ...state, done: true })
		let legacy = window.location.pathname.match(
			/^(\/app\/(?:doc|preview|space)\/)(co_z[1-9A-HJ-NP-Za-km-z]+)/,
		)
		if (legacy && !state.errors.length)
			window.location.replace(
				window.location.pathname.replace(
					legacy[2]!,
					await stableId(legacy[2]!),
				),
			)
	} finally {
		source.close()
	}
}
async function request(
	action: string,
	key: string,
	body: unknown,
): Promise<unknown> {
	let serialized = JSON.stringify(body)
	if (action === "item" && serialized.length > 2 * 1024 * 1024) {
		let input = z.object({ challengeId: z.string() }).parse(body)
		let staged: { base64?: string; uploadId?: string; sha256: string } =
			await packBytes(new TextEncoder().encode(serialized))
		await uploadLargeBytes(key, input.challengeId, staged)
		return request("staged-item", key, {
			uploadId: staged.uploadId,
			sha256: staged.sha256,
		})
	}
	let response = await fetch(`/api/classic-import?action=${action}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...deviceAuthorization(key),
		},
		body: serialized,
	})
	let data: unknown = await response.json()
	if (!response.ok)
		throw new Error(z.object({ error: z.string() }).parse(data).error)
	return data
}

async function uploadLargeBytes(
	key: string,
	challengeId: string,
	value: unknown,
): Promise<void> {
	if (!value || typeof value !== "object") return
	if (
		"base64" in value &&
		typeof value.base64 === "string" &&
		"sha256" in value &&
		typeof value.sha256 === "string" &&
		value.base64.length > 524288
	) {
		let base64 = value.base64
		for (
			let offset = 0, part = 0;
			offset < base64.length;
			offset += 524288, part++
		)
			await request("chunk", key, {
				challengeId,
				uploadId: value.sha256,
				part,
				base64: base64.slice(offset, offset + 524288),
			})
		Reflect.set(value, "uploadId", value.sha256)
		Reflect.deleteProperty(value, "base64")
		return
	}
	for (let child of Object.values(value))
		await uploadLargeBytes(key, challengeId, child)
}
