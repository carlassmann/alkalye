import { z } from "zod"
import type { Account } from "jazz-tools"

export { connectLocalJazzPoke, waitForLocalJazzStorage }

type LocalNode = Account["$jazz"]["localNode"]
type CoValueId = Parameters<LocalNode["getCoValue"]>[0]

let channelName = "alkalye:jazz-local-poke"
let localPokeMessageSchema = z.object({
	type: z.literal("poke"),
	from: z.string(),
	accountId: z.string(),
})

function connectLocalJazzPoke(account: Account) {
	if (typeof BroadcastChannel === "undefined") return () => {}

	let tabId = createTabId()
	let accountId = account.$jazz.id
	let node = account.$jazz.localNode
	let channel = new BroadcastChannel(channelName)
	let pokeQueued = false
	let closed = false
	let disconnectLocalWrites = observeLocalWrites(node, schedulePokeAfterStorage)

	channel.onmessage = event => {
		let result = localPokeMessageSchema.safeParse(event.data)
		if (!result.success) return

		let message = result.data
		if (message.from === tabId || message.accountId !== accountId) return

		loadKnownLocalState(account)
	}

	function schedulePokeAfterStorage(coValueId: CoValueId) {
		let storage = node.storage
		if (!storage) return

		void storage
			.waitForSync(coValueId, node.getCoValue(coValueId))
			.then(queuePoke, () => undefined)
	}

	function queuePoke() {
		if (closed || pokeQueued) return

		pokeQueued = true
		queueMicrotask(() => {
			pokeQueued = false
			if (closed) return
			channel.postMessage({ type: "poke", from: tabId, accountId })
		})
	}

	return () => {
		closed = true
		disconnectLocalWrites()
		channel.close()
	}
}

async function waitForLocalJazzStorage(account: Account) {
	let node = account.$jazz.localNode
	let storage = node.storage
	if (!storage) return

	let coValues = Array.from(node.allCoValues())
	await Promise.all(
		coValues.map(coValue =>
			storage.waitForSync(coValue.id, node.getCoValue(coValue.id)),
		),
	)
}

function observeLocalWrites(
	node: LocalNode,
	onLocalWrite: (coValueId: CoValueId) => void,
) {
	let syncManager = node.syncManager
	let originalSyncLocalTransaction = syncManager.syncLocalTransaction

	let syncLocalTransactionWithPoke: typeof syncManager.syncLocalTransaction = (
		coValue,
		knownStateBefore,
	) => {
		originalSyncLocalTransaction(coValue, knownStateBefore)
		onLocalWrite(coValue.id)
	}

	syncManager.syncLocalTransaction = syncLocalTransactionWithPoke

	return () => {
		if (syncManager.syncLocalTransaction === syncLocalTransactionWithPoke) {
			syncManager.syncLocalTransaction = originalSyncLocalTransaction
		}
	}
}

function loadKnownLocalState(account: Account) {
	let node = account.$jazz.localNode
	let storage = node.storage
	if (!storage) return

	for (let coValue of node.allCoValues()) {
		storage.load(coValue.id, data => {
			node.syncManager.handleNewContent(data, "storage")
		})
	}
}

function createTabId() {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID()
	}
	return `${Date.now()}:${Math.random()}`
}
