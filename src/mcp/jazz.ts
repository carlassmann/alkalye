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

export { createAgentAccount, openAgentAccount }

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
