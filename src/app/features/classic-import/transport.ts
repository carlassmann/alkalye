import { LocalNode, type Peer } from "cojson"
import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { WebSocketPeerWithReconnection } from "cojson-transport-ws"
export { connectClassic, classicServerUrl, classicPeers }

function classicServerUrl() {
	let url =
		import.meta.env.PUBLIC_JAZZ_CLASSIC_SYNC_SERVER ||
		import.meta.env.PUBLIC_JAZZ_SYNC_SERVER
	if (typeof url !== "string" || !/^wss?:\/\//.test(url))
		throw new Error("Classic sync server is not configured")
	return url
}
async function classicPeers() {
	let crypto = await WasmCrypto.create()
	let node: LocalNode | undefined
	let peers: Peer[] = []
	let peer = new WebSocketPeerWithReconnection({
		peer: classicServerUrl(),
		reconnectionTimeout: 1000,
		addPeer(peer) {
			if (node) node.syncManager.addPeer(peer)
			else peers.push(peer)
		},
		removePeer(peer) {
			if (node) node.syncManager.removePeer(peer.id)
			else {
				let index = peers.indexOf(peer)
				if (index !== -1) peers.splice(index, 1)
			}
		},
	})
	peer.enable()
	return {
		crypto,
		peer,
		peers,
		attach(value: LocalNode) {
			node = value
		},
		close() {
			peer.disable()
		},
	}
}
async function connectClassic() {
	let transport = await classicPeers()
	let crypto = transport.crypto
	let secret = crypto.newRandomAgentSecret()
	let node = new LocalNode(
		secret,
		crypto.newRandomSessionID(crypto.getAgentID(secret)),
		crypto,
	)
	for (let peer of transport.peers) node.syncManager.addPeer(peer)
	transport.attach(node)
	return {
		...transport,
		node,
		close() {
			transport.close()
			void node.gracefulShutdown()
		},
	}
}
