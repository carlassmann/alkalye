import { Group, type co } from "jazz-tools"
import { UserAccount, UserRoot } from "@/schema"
import {
	LaserHub,
	LaserState,
	LaserSender,
	laserMessageSchema,
	type LaserMessage,
} from "./laser-schema"

export { createLaserChannel, publishLaserMessage }

let stateBudget = 256
let hubBudget = 256
let senderLimit = 64
let maxAge = 15_000
let resolve = { laserHub: { current: { $each: true } } } as const

type Root = co.loaded<typeof UserRoot, typeof resolve>
type Envelope = Parameters<typeof LaserSender.create>[0]["value"]

function createLaserChannel(
	account: co.loaded<typeof UserAccount>,
	docId: string,
	onMessage: (message: LaserMessage) => void,
) {
	let source = crypto.randomUUID()
	let sequence = 0
	let root: Root | undefined
	let pending: LaserMessage | undefined
	let seen = new Map<string, number>()
	let closed = false
	let suspended = false
	function suspend() {
		pending = undefined
		suspended = true
	}
	function resume() {
		suspended = false
	}
	// Never append transactions after the browser begins releasing its Jazz session.
	window.addEventListener("pagehide", suspend)
	window.addEventListener("pageshow", resume)
	let scheduled = false

	let unsubscribe = account.$jazz.subscribe(
		{
			resolve: { root: resolve },
		},
		loaded => {
			root = loaded.root
			if (closed || suspended) return
			let state = loaded.root.laserHub?.current
			if (state) {
				for (let [sender, entry] of Object.entries(state)) {
					let envelope = entry.value
					if (sender === source || envelope.docId !== docId) continue
					if ((seen.get(sender) ?? 0) >= envelope.sequence) continue
					seen.set(sender, envelope.sequence)
					let parsed = laserMessageSchema.safeParse(envelope.message)
					if (parsed.success) onMessage(parsed.data)
				}
			}
			if (pending && !scheduled) {
				scheduled = true
				queueMicrotask(() => {
					scheduled = false
					if (closed || !pending) return
					let message = pending
					pending = undefined
					postMessage(message)
				})
			}
		},
	)

	function postMessage(message: LaserMessage) {
		if (closed || suspended) return
		if (!root) {
			pending = message
			return
		}
		let published = publishLaserMessage(root, account, source, {
			docId,
			sequence: ++sequence,
			sentAt: Date.now(),
			message,
		})
		pending = published ? undefined : message
	}

	return {
		postMessage,
		close() {
			closed = true
			unsubscribe()
			window.removeEventListener("pagehide", suspend)
			window.removeEventListener("pageshow", resume)
		},
	}
}

function publishLaserMessage(
	root: Root,
	account: co.loaded<typeof UserAccount>,
	source: string,
	envelope: Envelope,
) {
	let hub = root.laserHub
	if (hub && !hub.$isLoaded) return false
	if (!hub) {
		let owner = Group.create({ owner: account })
		hub = LaserHub.create(
			{ current: LaserState.create({}, { owner }) },
			{ owner },
		)
		root.$jazz.set("laserHub", hub)
		hub = root.laserHub
	}
	if (!hub?.$isLoaded) return false
	let state = hub.current
	if (!state.$isLoaded) return false
	let entries = Object.entries(state)
	if (entries.some(([, sender]) => !sender.$isLoaded)) return false
	let hasExpiredSenders =
		!state[source] &&
		entries.some(([, sender]) => envelope.sentAt - sender.value.sentAt > maxAge)
	if (
		transactionCount(state) >= stateBudget ||
		hasExpiredSenders ||
		(!state[source] && entries.length >= senderLimit)
	) {
		let snapshot: Parameters<typeof LaserState.create>[0] = {}
		for (let [sender, value] of entries
			.sort(([, a], [, b]) => b.value.sentAt - a.value.sentAt)
			.slice(0, senderLimit - 1)) {
			if (envelope.sentAt - value.value.sentAt <= maxAge)
				snapshot[sender] = value
		}
		state = LaserState.create(snapshot, { owner: state.$jazz.owner })
		if (transactionCount(hub) >= hubBudget) {
			hub = LaserHub.create({ current: state }, { owner: hub.$jazz.owner })
			root.$jazz.set("laserHub", hub)
		} else {
			hub.$jazz.set("current", state)
		}
		// A concurrent or future-dated edit can win over our replacement.
		hub = root.laserHub
		if (!hub?.$isLoaded || !hub.current.$isLoaded) return false
		state = hub.current
	}
	let sender = state[source]
	if (sender && !sender.$isLoaded) return false
	// A fresh writer per mounted controller avoids reusing a high-frequency
	// transaction stream when Jazz restores a browser session after reload.
	if (!sender || transactionCount(sender) >= stateBudget) {
		state.$jazz.set(
			source,
			LaserSender.create({ value: envelope }, { owner: state.$jazz.owner }),
		)
	} else {
		sender.$jazz.set("value", envelope)
	}
	return true
}

function transactionCount(
	value:
		| co.loaded<typeof LaserHub>
		| co.loaded<typeof LaserState>
		| co.loaded<typeof LaserSender>,
) {
	return Object.values(value.$jazz.raw.core.knownState().sessions).reduce(
		(sum, count) => sum + count,
		0,
	)
}
