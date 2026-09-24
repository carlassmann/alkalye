import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	createJazzTestAccount,
	setupJazzTestSync,
	getPeerConnectedToTestSyncServer,
} from "jazz-tools/testing"
import {
	type co,
	createJazzContextFromExistingCredentials,
	MockSessionProvider,
} from "jazz-tools"
import { UserAccount } from "@/schema"
import { runAccountMigration } from "@/schema/migrations"
import { createLaserChannel, publishLaserMessage } from "./laser-channel"
import {
	LaserHub,
	LaserState,
	LaserSender,
	type LaserMessage,
} from "./laser-schema"

let channels: ReturnType<typeof createLaserChannel>[] = []
let account: co.loaded<typeof UserAccount>

beforeEach(async () => {
	await setupJazzTestSync()
	account = await createJazzTestAccount({
		AccountSchema: UserAccount,
		isCurrentActiveAccount: true,
	})
})
afterEach(() => {
	for (let channel of channels) channel.close()
	channels = []
})

describe("account-private laser transport", () => {
	test("delivers across independent channels, scoped to document", async () => {
		let received: LaserMessage[] = []
		let otherDocument: LaserMessage[] = []
		let receiver = createLaserChannel(account, "doc-a", message =>
			received.push(message),
		)
		let unrelated = createLaserChannel(account, "doc-b", message =>
			otherDocument.push(message),
		)
		let sender = createLaserChannel(account, "doc-a", () => {})
		channels.push(receiver, unrelated, sender)
		sender.postMessage({
			type: "display",
			lease: "test-lease",
			requests: [],
			id: "screen",
			width: 1920,
			height: 1080,
			appearance: "dark",
			slideNumber: 1,
		})
		await expect.poll(() => received.length).toBe(1)
		expect(received[0]?.type).toBe("display")
		expect(otherDocument).toEqual([])
	})

	test("does not publish after pagehide and resumes on pageshow", async () => {
		let received: LaserMessage[] = []
		let sender = createLaserChannel(account, "doc", () => {})
		let receiver = createLaserChannel(account, "doc", message =>
			received.push(message),
		)
		channels.push(sender, receiver)
		sender.postMessage({ type: "discover", request: "before" })
		await expect.poll(() => received.length).toBe(1)
		window.dispatchEvent(new Event("pagehide"))
		sender.postMessage({ type: "discover", request: "suspended" })
		window.dispatchEvent(new Event("pageshow"))
		sender.postMessage({ type: "discover", request: "resumed" })
		await expect.poll(() => received.length).toBe(2)
		expect(received).toEqual([
			{ type: "discover", request: "before" },
			{ type: "discover", request: "resumed" },
		])
	})

	test("prunes expired streams when a new session starts", async () => {
		let { root } = await account.$jazz.ensureLoaded({
			resolve: { root: { laserHub: { current: { $each: true } } } },
		})
		publishLaserMessage(root, account, "old-screen", {
			docId: "doc",
			sequence: 1,
			sentAt: 0,
			message: { type: "discover", request: "old" },
		})
		publishLaserMessage(root, account, "new-screen", {
			docId: "doc",
			sequence: 1,
			sentAt: 30_000,
			message: { type: "discover", request: "new" },
		})
		expect(Object.keys(root.laserHub?.current ?? {})).toEqual(["new-screen"])
	})

	test("bounds discovery even when obsolete clients have future timestamps", async () => {
		let { root } = await account.$jazz.ensureLoaded({
			resolve: { root: { laserHub: { current: { $each: true } } } },
		})
		for (let index = 0; index < 100; index++) {
			publishLaserMessage(root, account, `screen-${index}`, {
				docId: "doc",
				sequence: 1,
				sentAt: 1_000_000 - index,
				message: { type: "discover", request: String(index) },
			})
		}
		expect(Object.keys(root.laserHub?.current ?? {})).toHaveLength(64)
		expect(root.laserHub?.current["screen-99"]).toBeDefined()
	})

	test("another account cannot read the hub even when given its ID", async () => {
		let sender = createLaserChannel(account, "shared-document", () => {})
		channels.push(sender)
		sender.postMessage({ type: "discover", request: "test-request" })
		let loaded = await account.$jazz.ensureLoaded({
			resolve: { root: { laserHub: { current: { $each: true } } } },
		})
		await expect.poll(() => loaded.root.laserHub?.$jazz.id).toBeTruthy()
		let id = loaded.root.laserHub?.$jazz.id
		if (!id) throw new Error("Missing laser hub")
		let otherAccount = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})
		let hub = await LaserHub.load(id, { loadAs: otherAccount })
		expect(hub.$jazz.loadingState).toBe("unauthorized")
	})

	test("preserves discovery when the account root is compacted", async () => {
		let { root } = await account.$jazz.ensureLoaded({
			resolve: { root: { laserHub: { current: { $each: true } } } },
		})
		publishLaserMessage(root, account, "screen", {
			docId: "doc",
			sequence: 1,
			sentAt: Date.now(),
			message: { type: "discover", request: "test-request" },
		})
		let hubId = root.laserHub?.$jazz.id
		root.$jazz.set("migrationVersion", 1)
		await runAccountMigration(account)
		let after = await account.$jazz.ensureLoaded({
			resolve: { root: { laserHub: true } },
		})
		expect(after.root.$jazz.id).not.toBe(root.$jazz.id)
		expect(after.root.laserHub?.$jazz.id).toBe(hubId)
	})

	test("rotates high-frequency history without growing the account root", async () => {
		let { root } = await account.$jazz.ensureLoaded({
			resolve: { root: { laserHub: { current: { $each: true } } } },
		})
		let initialRootTransactions =
			root.$jazz.raw.core.getValidSortedTransactions().length
		let firstStateId: string | undefined
		for (let sequence = 1; sequence <= 600; sequence++) {
			publishLaserMessage(root, account, "controller", {
				docId: "doc",
				sequence,
				sentAt: Date.now(),
				message: {
					type: "point",
					lease: "test-lease",
					layout: "test-layout",
					target: "screen",
					slideNumber: 1,
					x: sequence / 600,
					y: 0.5,
					visible: true,
				},
			})
			firstStateId ??= root.laserHub?.current.controller?.$jazz.id
		}
		let hub = root.laserHub
		if (!hub) throw new Error("Missing laser hub")
		expect(hub.current.controller?.$jazz.id).not.toBe(firstStateId)
		expect(hub.current.controller?.value.sequence).toBe(600)
		expect(
			hub.current.controller?.$jazz.raw.core.getValidSortedTransactions()
				.length,
		).toBeLessThanOrEqual(256)
		expect(
			root.$jazz.raw.core.getValidSortedTransactions().length -
				initialRootTransactions,
		).toBe(1)
	})
})

test("publishes into the winning registry when clock skew prevents rotation", async () => {
	let { root } = await account.$jazz.ensureLoaded({
		resolve: { root: { laserHub: { current: { $each: true } } } },
	})
	let now = Date.now()
	publishLaserMessage(root, account, "display", {
		docId: "doc",
		sequence: 1,
		sentAt: now,
		message: { type: "discover", request: "initial" },
	})
	let hub = root.laserHub
	if (!hub) throw new Error("Missing hub")
	let clock = vi
		.spyOn(account.$jazz.localNode, "stampNow")
		.mockReturnValue(now + 60_000)
	try {
		let state = LaserState.create({}, { owner: hub.$jazz.owner })
		hub.$jazz.set("current", state)
		let sender = LaserSender.create(
			{
				value: {
					docId: "doc",
					sequence: 1,
					sentAt: now + 60_000,
					message: { type: "discover", request: "display" },
				},
			},
			{ owner: hub.$jazz.owner },
		)
		for (let index = 0; index < 256; index++) state.$jazz.set("display", sender)
		clock.mockReturnValue(now + 30_000)
		publishLaserMessage(root, account, "controller", {
			docId: "doc",
			sequence: 1,
			sentAt: now + 30_000,
			message: { type: "discover", request: "controller" },
		})
		expect(hub.current.controller?.value.message).toEqual({
			type: "discover",
			request: "controller",
		})
	} finally {
		clock.mockRestore()
	}
})

test("queues the latest message while a remote registry loads", async () => {
	let channel = createLaserChannel(account, "doc", () => {})
	channels.push(channel)
	channel.postMessage({ type: "discover", request: "before" })
	let { root } = await account.$jazz.ensureLoaded({
		resolve: { root: { laserHub: { current: { $each: true } } } },
	})
	await expect.poll(() => root.laserHub).toBeDefined()
	await account.$jazz.waitForAllCoValuesSync()
	let remote = await createJazzContextFromExistingCredentials({
		credentials: {
			accountID: account.$jazz.id,
			secret: account.$jazz.localNode.getCurrentAgent().agentSecret,
		},
		AccountSchema: UserAccount,
		peers: [getPeerConnectedToTestSyncServer()],
		crypto: account.$jazz.localNode.crypto,
		sessionProvider: new MockSessionProvider(),
		asActiveAccount: false,
	})
	try {
		let remoteRoot = (
			await remote.account.$jazz.ensureLoaded({
				resolve: { root: { laserHub: { current: { $each: true } } } },
			})
		).root
		let hub = root.laserHub
		let remoteHub = remoteRoot.laserHub
		if (!hub || !remoteHub) throw new Error("Missing hub")
		for (let id of Object.keys(account.$jazz.localNode.syncManager.peers))
			account.$jazz.localNode.syncManager.removePeer(id)
		let next = LaserState.create({}, { owner: remoteHub.$jazz.owner })
		hub.$jazz.raw.set("current", next.$jazz.id)
		await expect.poll(() => hub.current.$isLoaded).toBe(false)
		expect(() =>
			channel.postMessage({ type: "discover", request: "while-loading" }),
		).not.toThrow()
		channel.postMessage({ type: "discover", request: "latest" })
		account.$jazz.localNode.syncManager.addPeer(
			getPeerConnectedToTestSyncServer(),
		)
		await expect.poll(() => hub.current.$isLoaded).toBe(true)
		await expect
			.poll(() =>
				Object.values(hub.current).some(
					sender =>
						sender.value.message.type === "discover" &&
						sender.value.message.request === "latest",
				),
			)
			.toBe(true)
	} finally {
		await remote.done()
	}
})
