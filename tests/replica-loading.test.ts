import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { Replica } from "../src/shared/crdt"

function largeReplica() {
	let replica = new Replica("source", "Source writer")
	let source = "---\ntitle: Shared notes\n---\n" + "A 😀 line.\n".repeat(8192)
	let initial = replica.edit("document", source)
	if (!initial) throw new Error("Missing initial document")
	return { replica, source }
}

test("cooperative replica copies preserve snapshots and independently merge Unicode edits", async () => {
	let { replica, source } = largeReplica()
	replica.text("document")
	let foregroundRan = false
	let foreground = setImmediate(() => {
		foregroundRan = true
	})
	try {
		let copied = await Effect.runPromise(
			replica.forkEffect("peer", "Peer writer"),
		)
		expect(foregroundRan).toBe(true)
		expect(copied.checkpoint()).toEqual(replica.fork().checkpoint())
		expect(copied.actor).toBe("peer")
		expect(copied.author).toBe("Peer writer")
		expect(copied.text("document")).toBe(source)
		let peer = copied.edit("document", source + "Peer 🌻")
		let owner = replica.edit("document", "Owner 🦋\n" + source)
		if (!peer || !owner) throw new Error("Missing concurrent edits")
		expect(replica.text("document")).not.toContain("Peer 🌻")
		expect(copied.text("document")).not.toContain("Owner 🦋")
		replica.apply([peer])
		copied.apply([owner])
		expect(copied.text("document")).toBe(replica.text("document"))
		copied.cancel("document", peer.id)
		expect(copied.text("document")).not.toContain("Peer 🌻")
		expect(replica.text("document")).toContain("Peer 🌻")
	} finally {
		clearImmediate(foreground)
	}
})

test("interrupted replica copies leave the source usable and can be retried", async () => {
	let { replica, source } = largeReplica()
	let copied = await Effect.runPromise(
		Effect.gen(function* () {
			let copying = yield* Effect.forkChild(replica.forkEffect("interrupted"), {
				startImmediately: true,
			})
			yield* Fiber.interrupt(copying)
			return yield* replica.forkEffect("retry")
		}),
	)
	expect(replica.text("document")).toBe(source)
	expect(copied.text("document")).toBe(source)
	expect(copied.actor).toBe("retry")
})

test("a concurrent source edit rejects a partially copied replica", async () => {
	let { replica, source } = largeReplica()
	let outcome = await Effect.runPromise(
		Effect.gen(function* () {
			let copying = yield* Effect.forkChild(replica.forkEffect("concurrent"), {
				startImmediately: true,
			})
			replica.edit("document", source + "Changed during copy")
			return yield* Fiber.await(copying)
		}),
	)
	expect(outcome._tag).toBe("Failure")
	expect(replica.text("document")).toBe(source + "Changed during copy")
})

test("cooperative materialization yields while preserving frontmatter and Unicode offsets", async () => {
	let { replica, source } = largeReplica()
	let cold = new Replica("cold")
	cold.restore(replica.checkpoint())
	let foregroundRan = false
	let foreground = setImmediate(() => {
		foregroundRan = true
	})
	try {
		expect(await Effect.runPromise(cold.textEffect("document"))).toBe(source)
		expect(foregroundRan).toBe(true)
		expect(cold.text("document")).toBe(source)
		expect(cold.metadata("document").title).toBe("Shared notes")
		let following = source.replace("😀", "🦋")
		cold.edit("document", following)
		expect(cold.text("document")).toBe(following)
	} finally {
		clearImmediate(foreground)
	}
})

test("concurrent materialization never publishes a stale source cache", async () => {
	let { replica, source } = largeReplica()
	let cold = new Replica("cold")
	cold.restore(replica.checkpoint())
	let outcome = await Effect.runPromise(
		Effect.gen(function* () {
			let reading = yield* Effect.forkChild(cold.textEffect("document"), {
				startImmediately: true,
			})
			cold.edit("document", source + "Changed during read")
			return yield* Fiber.await(reading)
		}),
	)
	expect(outcome._tag).toBe("Failure")
	expect(cold.text("document")).toBe(source + "Changed during read")
	expect(cold.visible("document").length).toBe(
		Array.from(source + "Changed during read").length,
	)
})

test("interrupted materialization can be read and retried without partial caches", async () => {
	let { replica, source } = largeReplica()
	let cold = new Replica("cold")
	cold.restore(replica.checkpoint())
	await Effect.runPromise(
		Effect.gen(function* () {
			let reading = yield* Effect.forkChild(cold.textEffect("document"), {
				startImmediately: true,
			})
			yield* Fiber.interrupt(reading)
		}),
	)
	expect(cold.text("document")).toBe(source)
	expect(await Effect.runPromise(cold.textEffect("document"))).toBe(source)
})

test("synchronous reads during cooperative materialization share the same source", async () => {
	let { replica, source } = largeReplica()
	let cold = new Replica("cold")
	cold.restore(replica.checkpoint())
	let result = await Effect.runPromise(
		Effect.gen(function* () {
			let reading = yield* Effect.forkChild(cold.textEffect("document"), {
				startImmediately: true,
			})
			expect(cold.text("document")).toBe(source)
			return yield* Fiber.join(reading)
		}),
	)
	expect(result).toBe(source)
	expect(cold.visible("document").length).toBe(Array.from(source).length)
})

for (let cooperative of [false, true]) {
	test(`forked deletion histories independently remove and undo the same atom (cooperative=${cooperative})`, async () => {
		let owner = new Replica("owner", "Owner")
		owner.edit("document", "ABC")
		let removal = owner.edit("document", "AC")
		if (!removal) throw new Error("Missing removal")
		let peer = cooperative
			? await Effect.runPromise(owner.forkEffect("peer", "Peer"))
			: owner.fork("peer", "Peer")
		let peerUndo = peer.cancel("document", removal.id)
		expect(peer.text("document")).toBe("ABC")
		expect(owner.text("document")).toBe("AC")
		let peerRemoval = peer.edit("document", "AC")
		if (!peerRemoval || !peerUndo) throw new Error("Missing peer edits")
		let ownerUndo = owner.cancel("document", removal.id)
		if (!ownerUndo) throw new Error("Missing owner undo")
		expect(owner.text("document")).toBe("ABC")
		expect(peer.text("document")).toBe("AC")
		let ownerRedo = owner.cancel("document", ownerUndo.id)
		expect(owner.text("document")).toBe("AC")
		let peerRedo = peer.cancel("document", peerRemoval.id)
		expect(peer.text("document")).toBe("ABC")
		if (!ownerRedo || !peerRedo) throw new Error("Missing repeated undo")
		owner.apply([peerUndo, peerRemoval, peerRedo])
		peer.apply([ownerUndo, ownerRedo])
		expect(peer.text("document")).toBe(owner.text("document"))
	})
}

for (let cooperative of [false, true]) {
	test(`forked cancellation chains keep repeated undo isolated (cooperative=${cooperative})`, async () => {
		let owner = new Replica("owner", "Owner")
		owner.edit("document", "ABC")
		let removal = owner.edit("document", "AC")
		if (!removal) throw new Error("Missing removal")
		let undo = owner.cancel("document", removal.id)
		if (!undo) throw new Error("Missing undo")
		let peer = cooperative
			? await Effect.runPromise(owner.forkEffect("peer", "Peer"))
			: owner.fork("peer", "Peer")
		let ownerRedo = owner.cancel("document", undo.id)
		expect(owner.text("document")).toBe("AC")
		expect(peer.text("document")).toBe("ABC")
		let peerRedo = peer.cancel("document", undo.id)
		let peerUndo = peer.cancel("document", removal.id)
		expect(peer.text("document")).toBe("ABC")
		expect(owner.text("document")).toBe("AC")
		if (!ownerRedo || !peerUndo || !peerRedo)
			throw new Error("Missing repeated cancellations")
		owner.apply([peerUndo, peerRedo])
		peer.apply([ownerRedo])
		expect(peer.text("document")).toBe("ABC")
		expect(owner.text("document")).toBe("ABC")
	})
}

test("a concurrent deletion undo rejects a partially copied replica", async () => {
	let { replica, source } = largeReplica()
	let removal = replica.edit("document", "")
	if (!removal) throw new Error("Missing removal")
	let outcome = await Effect.runPromise(
		Effect.gen(function* () {
			let copying = yield* Effect.forkChild(replica.forkEffect("concurrent"), {
				startImmediately: true,
			})
			replica.cancel("document", removal.id)
			return yield* Fiber.await(copying)
		}),
	)
	expect(outcome._tag).toBe("Failure")
	expect(replica.text("document")).toBe(source)
	let retry = await Effect.runPromise(replica.forkEffect("retry"))
	expect(retry.text("document")).toBe(source)
})
