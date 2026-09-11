import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { WebSocketPeerWithReconnection } from "cojson-transport-ws"
import {
	MockSessionProvider,
	createJazzContextForNewAccount,
	createJazzContextFromExistingCredentials,
	type Loaded,
	type Peer,
} from "jazz-tools"
import { UserAccount } from "@/schema"
import type { AgentCredentials } from "./credentials"

export {
	createAgentAccount,
	openAgentAccount,
	runWithAgentAccount,
	closeAgentAccountRuntime,
}

type OpenAgent = Awaited<ReturnType<typeof openAgentAccount>>
interface AgentRuntime {
	agent: Promise<OpenAgent>
	tail: Promise<void>
	active: number
	lastUsedAt: number
	invalidated: boolean
}

let agentRuntimes = new Map<string, AgentRuntime>()
let agentOperationTimeout = 20_000
let agentToolTimeout = 60_000
let agentRuntimeIdleTimeout = 5 * 60_000
let maximumAgentRuntimes = 32

async function createAgentAccount(syncServer: string, name: string) {
	let cryptoProvider = await WasmCrypto.create()
	let peer = createPeer(syncServer)
	let context = await createJazzContextForNewAccount({
		creationProps: { name },
		peers: peer.peers,
		crypto: cryptoProvider,
		AccountSchema: UserAccount,
		sessionProvider: new MockSessionProvider(),
	})
	peer.attach(context.node)
	let account = await context.account.$jazz.ensureLoaded({
		resolve: {
			root: { documents: true, inactiveDocuments: true, spaces: true },
		},
	})
	account.root.documents.$jazz.splice(0, account.root.documents.length)
	await context.account.$jazz.waitForAllCoValuesSync({ timeout: 10_000 })

	return {
		credentials: {
			accountId: context.account.$jazz.id,
			accountSecret: context.node.getCurrentAgent().agentSecret,
		},
		async close() {
			context.done()
			peer.close()
		},
	}
}

async function openAgentAccount(
	syncServer: string,
	credentials: AgentCredentials,
) {
	let cryptoProvider = await WasmCrypto.create()
	let peer = createPeer(syncServer)
	let context = await createJazzContextFromExistingCredentials({
		credentials: {
			accountID: credentials.accountId,
			secret: credentials.accountSecret,
		},
		peers: peer.peers,
		crypto: cryptoProvider,
		AccountSchema: UserAccount,
		sessionProvider: new MockSessionProvider(),
		asActiveAccount: true,
	})
	peer.attach(context.node)

	return {
		account: context.account,
		async close() {
			context.done()
			peer.close()
		},
	}
}

async function runWithAgentAccount<Result>(
	syncServer: string,
	credentials: AgentCredentials,
	operation: (agent: OpenAgent) => Promise<Result>,
	operationTimeoutMs: number | false = agentToolTimeout,
) {
	await evictIdleAgentRuntimes()
	let key = credentials.accountId
	let runtime = agentRuntimes.get(key)
	if (!runtime) {
		runtime = {
			agent: openAgentAccount(syncServer, credentials),
			tail: Promise.resolve(),
			active: 0,
			lastUsedAt: Date.now(),
			invalidated: false,
		}
		agentRuntimes.set(key, runtime)
	}

	let release: () => void = () => undefined
	let previous = runtime.tail
	runtime.tail = new Promise<void>(resolve => {
		release = resolve
	})
	runtime.active++
	await previous
	if (runtime.invalidated) {
		runtime.active--
		release()
		return runWithAgentAccount(
			syncServer,
			credentials,
			operation,
			operationTimeoutMs,
		)
	}
	try {
		let agent: OpenAgent
		try {
			agent = await withDeadline(runtime.agent, agentOperationTimeout)
		} catch (error) {
			invalidateAgentRuntime(key, runtime)
			throw error
		}
		try {
			let result = operation(agent)
			return operationTimeoutMs === false
				? await result
				: await withDeadline(result, operationTimeoutMs)
		} catch (error) {
			if (error instanceof AgentRuntimeTimeoutError) {
				invalidateAgentRuntime(key, runtime)
			}
			throw error
		}
	} finally {
		runtime.active--
		runtime.lastUsedAt = Date.now()
		release()
	}
}

function invalidateAgentRuntime(key: string, runtime: AgentRuntime) {
	runtime.invalidated = true
	if (agentRuntimes.get(key) === runtime) agentRuntimes.delete(key)
	void runtime.agent.then(agent => agent.close()).catch(() => undefined)
}

async function evictIdleAgentRuntimes() {
	let now = Date.now()
	let idle = [...agentRuntimes.entries()]
		.filter(([, runtime]) => runtime.active === 0)
		.sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)
	for (let [key, runtime] of idle) {
		if (
			now - runtime.lastUsedAt < agentRuntimeIdleTimeout &&
			agentRuntimes.size <= maximumAgentRuntimes
		) {
			continue
		}
		agentRuntimes.delete(key)
		void runtime.agent.then(agent => agent.close()).catch(() => undefined)
	}
}

async function closeAgentAccountRuntime(accountId: string) {
	let runtime = agentRuntimes.get(accountId)
	if (!runtime) return
	agentRuntimes.delete(accountId)
	await runtime.tail
	let agent = await runtime.agent
	await agent.close()
}

async function withDeadline<Result>(
	promise: Promise<Result>,
	timeoutMs: number,
) {
	let timeout: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new AgentRuntimeTimeoutError(timeoutMs)),
					timeoutMs,
				)
			}),
		])
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

class AgentRuntimeTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Agent operation timed out after ${timeoutMs}ms`)
		this.name = "AgentRuntimeTimeoutError"
	}
}

function createPeer(syncServer: string) {
	let peers: Peer[] = []
	let node: Loaded<typeof UserAccount>["$jazz"]["localNode"] | undefined
	let websocketPeer = new WebSocketPeerWithReconnection({
		peer: syncServer,
		reconnectionTimeout: 100,
		addPeer(nextPeer) {
			if (node) node.syncManager.addPeer(nextPeer)
			else peers.push(nextPeer)
		},
		removePeer() {},
		WebSocketConstructor: WebSocket,
	})
	websocketPeer.enable()

	return {
		peers,
		attach(nextNode: Loaded<typeof UserAccount>["$jazz"]["localNode"]) {
			node = nextNode
			for (let currentPeer of peers) node.syncManager.addPeer(currentPeer)
			peers.splice(0)
		},
		close() {
			websocketPeer.disable()
		},
	}
}
