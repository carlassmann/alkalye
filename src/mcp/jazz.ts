import { InvalidConnectionError } from "./errors"
import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { WebSocketPeerWithReconnection } from "cojson-transport-ws"
import {
	MockSessionProvider,
	co,
	createJazzContextFromExistingCredentials,
	type Loaded,
	type Peer,
} from "jazz-tools"
import {
	UserAccount,
	UserRoot,
	McpConnection,
	createMcpConnections,
} from "@/schema"
import {
	accountCredentialsSchema,
	type ConnectionCredentials,
} from "./credentials"
import type { z } from "zod"
import type { TokenCodec } from "./token"
import { createHash } from "node:crypto"

export {
	createUserConnection,
	openUserAccount,
	runWithUserAccount,
	revokeUserConnection,
}

type OpenUser = Awaited<ReturnType<typeof openUserAccount>>
interface UserRuntime {
	user: Promise<OpenUser>
	tail: Promise<void>
	active: number
	lastUsedAt: number
	invalidated: boolean
}

let userRuntimes = new Map<string, UserRuntime>()
let userOperationTimeout = 20_000
let userToolTimeout = 60_000
let userRuntimeIdleTimeout = 5 * 60_000
let maximumUserRuntimes = 32

async function createUserConnection(
	syncServer: string,
	credentials: z.infer<typeof accountCredentialsSchema>,
	client: { id: string; name: string },
	tokens: TokenCodec,
) {
	return runWithUserAccountState(
		syncServer,
		credentials,
		async user => {
			let account = await user.account.$jazz.ensureLoaded({
				resolve: { root: true },
			})
			let existingId = account.root.mcpConnections?.$jazz.id
			let list = existingId
				? await co
						.list(McpConnection)
						.load(existingId, { loadAs: user.account })
				: await createMcpConnections(account.root.$jazz.owner)
			if (!list.$isLoaded) throw new Error("MCP connections are unavailable")
			let root: co.loaded<typeof UserRoot> = account.root
			if (!existingId) root.$jazz.set("mcpConnections", list)
			let connection = McpConnection.create(
				{
					clientId: client.id,
					clientName: client.name,
					credential: "",
					createdAt: new Date(),
				},
				account.root.$jazz.owner,
			)
			let credential = await tokens.seal("connection", {
				...credentials,
				connectionId: connection.$jazz.id,
				clientId: client.id,
			})
			connection.$jazz.set("credential", credential)
			list.$jazz.push(connection)
			await account.$jazz.waitForAllCoValuesSync({ timeout: 10_000 })
			return credential
		},
		userToolTimeout,
		false,
	)
}

async function openUserAccount(
	syncServer: string,
	credentials: z.infer<typeof accountCredentialsSchema>,
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
		asActiveAccount: false,
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

async function runWithUserAccount<Result>(
	syncServer: string,
	credentials: ConnectionCredentials,
	operation: (user: OpenUser) => Promise<Result>,
	operationTimeoutMs: number | false = userToolTimeout,
): Promise<Result> {
	return runWithUserAccountState(
		syncServer,
		credentials,
		operation,
		operationTimeoutMs,
		false,
	)
}

async function revokeUserConnection(
	syncServer: string,
	credentials: ConnectionCredentials,
) {
	await runWithUserAccountState(
		syncServer,
		credentials,
		async user => {
			let account = await user.account.$jazz.ensureLoaded({
				resolve: { root: { mcpConnections: { $each: true } } },
			})
			let connection = account.root.mcpConnections?.find(
				item => item.$jazz.id === credentials.connectionId,
			)
			if (!connection) throw new InvalidConnectionError()
			connection.$jazz.set("revokedAt", new Date())
			await account.$jazz.waitForAllCoValuesSync({ timeout: 10_000 })
		},
		userToolTimeout,
		true,
	)
}

async function runWithUserAccountState<Result>(
	syncServer: string,
	credentials: z.infer<typeof accountCredentialsSchema> | ConnectionCredentials,
	operation: (user: OpenUser) => Promise<Result>,
	operationTimeoutMs: number | false,
	allowRevoked: boolean,
): Promise<Result> {
	await evictIdleUserRuntimes()
	let key = createHash("sha256")
		.update(syncServer)
		.update(credentials.accountId)
		.update(credentials.accountSecret)
		.digest("hex")
	let runtime = userRuntimes.get(key)
	if (!runtime) {
		if (userRuntimes.size >= maximumUserRuntimes)
			throw new Error("MCP server is busy")
		runtime = {
			user: openUserAccount(syncServer, credentials),
			tail: Promise.resolve(),
			active: 0,
			lastUsedAt: Date.now(),
			invalidated: false,
		}
		userRuntimes.set(key, runtime)
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
		return runWithUserAccountState(
			syncServer,
			credentials,
			operation,
			operationTimeoutMs,
			allowRevoked,
		)
	}
	try {
		let user: OpenUser
		try {
			user = await withDeadline(runtime.user, userOperationTimeout)
		} catch (error) {
			invalidateUserRuntime(key, runtime)
			throw error
		}
		let account = await withDeadline(
			user.account.$jazz.ensureLoaded({
				resolve: { root: { mcpConnections: { $each: true } } },
			}),
			userOperationTimeout,
		)
		if ("connectionId" in credentials) {
			let connection = account.root.mcpConnections?.find(
				item => item.$jazz.id === credentials.connectionId,
			)
			if (
				!connection ||
				connection.clientId !== credentials.clientId ||
				(!allowRevoked && connection.revokedAt)
			) {
				throw new InvalidConnectionError()
			}
		}
		let result = operation(user)
		return operationTimeoutMs === false
			? await result
			: await withDeadline(result, operationTimeoutMs)
	} catch (error) {
		if (error instanceof UserRuntimeTimeoutError)
			invalidateUserRuntime(key, runtime)
		throw error
	} finally {
		runtime.active--
		runtime.lastUsedAt = Date.now()
		release()
	}
}

function invalidateUserRuntime(key: string, runtime: UserRuntime) {
	if (runtime.invalidated) return
	runtime.invalidated = true
	if (userRuntimes.get(key) === runtime) userRuntimes.delete(key)
	void runtime.user.then(user => user.close()).catch(() => undefined)
}

async function evictIdleUserRuntimes() {
	let now = Date.now()
	let idle = [...userRuntimes.entries()]
		.filter(([, runtime]) => runtime.active === 0)
		.sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)
	for (let [key, runtime] of idle) {
		if (
			now - runtime.lastUsedAt < userRuntimeIdleTimeout &&
			userRuntimes.size < maximumUserRuntimes
		) {
			continue
		}
		userRuntimes.delete(key)
		void runtime.user.then(user => user.close()).catch(() => undefined)
	}
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
					() => reject(new UserRuntimeTimeoutError(timeoutMs)),
					timeoutMs,
				)
			}),
		])
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

class UserRuntimeTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`User operation timed out after ${timeoutMs}ms`)
		this.name = "UserRuntimeTimeoutError"
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
