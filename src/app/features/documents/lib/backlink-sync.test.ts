import { describe, expect, test } from "vitest"
import {
	backlinkMeResolve,
	backlinkSpaceResolve,
	createBacklinkSyncCoordinator,
	getBacklinkLinkChanges,
	getWikilinkIds,
} from "./backlink-sync"

describe("backlink sync queries", () => {
	test("loads list entries without editor payloads", () => {
		expect(backlinkMeResolve.root.documents).toEqual({ $each: true })
		expect(backlinkSpaceResolve.documents).toEqual({ $each: true })
	})
})

describe("backlink sync link changes", () => {
	test("detects removed links from opened document baseline", () => {
		let initialLinkIds = getWikilinkIds("[[doc-a]] [[doc-b]]")
		let changes = getBacklinkLinkChanges(initialLinkIds, "[[doc-a]]")

		expect(changes.addedIds).toEqual([])
		expect(changes.removedIds).toEqual(["doc-b"])
		expect(changes.currentLinkIds).toEqual(new Set(["doc-a"]))
	})

	test("detects added links after opened document baseline", () => {
		let initialLinkIds = getWikilinkIds("[[doc-a]]")
		let changes = getBacklinkLinkChanges(initialLinkIds, "[[doc-a]] [[doc-b]]")

		expect(changes.addedIds).toEqual(["doc-b"])
		expect(changes.removedIds).toEqual([])
		expect(changes.currentLinkIds).toEqual(new Set(["doc-a", "doc-b"]))
	})
})

describe("backlink sync coordinator", () => {
	test("coalesces while waiting for idle and ignores a closed session", async () => {
		let gate = makeDeferred()
		let coordinator = createBacklinkSyncCoordinator(() => gate.promise)
		let session = coordinator.openSession("source", "")
		coordinator.setReady(session, true)
		coordinator.queue(session, "[[old]]")
		let seen: string[] = []
		let runAttempt: Parameters<typeof coordinator.run>[1] = async attempt => {
			seen.push(attempt.content)
			return {
				status: "synced",
				currentLinkIds: getWikilinkIds(attempt.content),
			}
		}
		let running = coordinator.run(session, runAttempt)
		coordinator.queue(session, "[[newest]]")
		expect(seen).toEqual([])
		gate.resolve()
		await running
		expect(seen).toEqual(["[[newest]]"])
		coordinator.queue(session, "[[closed]]")
		let closing = coordinator.run(session, runAttempt)
		coordinator.closeSession(session)
		await closing
		expect(seen).toEqual(["[[newest]]"])
	})

	test("does not let delayed document work consume the next session queue", async () => {
		let delayed = makeDeferred()
		let attempts: Array<{
			sourceId: string
			content: string
			baseline: Set<string>
		}> = []
		let mutations: Array<{ sourceId: string; content: string }> = []
		let coordinator = createBacklinkSyncCoordinator()
		let runAttempt: Parameters<typeof coordinator.run>[1] = async attempt => {
			attempts.push({
				sourceId: attempt.sourceId,
				content: attempt.content,
				baseline: new Set(attempt.lastSyncedLinkIds),
			})
			if (attempt.sourceId === "doc-a") await delayed.promise
			if (!attempt.shouldContinue()) return { status: "interrupted" }
			mutations.push({
				sourceId: attempt.sourceId,
				content: attempt.content,
			})
			return {
				status: "synced",
				currentLinkIds: getWikilinkIds(attempt.content),
			}
		}

		let sessionA = coordinator.openSession("doc-a", "[[target-a]]")
		coordinator.setReady(sessionA, true)
		coordinator.queue(sessionA, "[[target-a-2]]")
		let runA = coordinator.run(sessionA, runAttempt)
		await Promise.resolve()

		let sessionB = coordinator.openSession("doc-b", "[[target-b]]")
		coordinator.setReady(sessionB, true)
		coordinator.queue(sessionB, "[[target-b-1]]")
		let runB = coordinator.run(sessionB, runAttempt)
		coordinator.queue(sessionB, "[[target-b-2]]")
		delayed.resolve()
		await Promise.all([runA, runB])

		expect(attempts).toEqual([
			{
				sourceId: "doc-a",
				content: "[[target-a-2]]",
				baseline: new Set(["target-a"]),
			},
			{
				sourceId: "doc-b",
				content: "[[target-b-2]]",
				baseline: new Set(["target-b"]),
			},
		])
		expect(mutations).toEqual([
			{ sourceId: "doc-b", content: "[[target-b-2]]" },
		])
	})

	test("retains queued content while unready and after readiness interruption", async () => {
		let delayed = makeDeferred()
		let attemptCount = 0
		let syncedContents: string[] = []
		let coordinator = createBacklinkSyncCoordinator()
		let runAttempt: Parameters<typeof coordinator.run>[1] = async attempt => {
			attemptCount += 1
			if (attemptCount === 1) await delayed.promise
			if (!attempt.shouldContinue()) return { status: "interrupted" }
			syncedContents.push(attempt.content)
			return {
				status: "synced",
				currentLinkIds: getWikilinkIds(attempt.content),
			}
		}
		let session = coordinator.openSession("doc-a", "")

		coordinator.queue(session, "[[target]]")
		await coordinator.run(session, runAttempt)
		expect(attemptCount).toBe(0)

		coordinator.setReady(session, true)
		let interruptedRun = coordinator.run(session, runAttempt)
		await Promise.resolve()
		coordinator.setReady(session, false)
		delayed.resolve()
		await interruptedRun
		expect(syncedContents).toEqual([])

		coordinator.setReady(session, true)
		await coordinator.run(session, runAttempt)
		expect(attemptCount).toBe(2)
		expect(syncedContents).toEqual(["[[target]]"])
	})

	test("retains failed content without rejecting or retrying until another run", async () => {
		let attempts: string[] = []
		let coordinator = createBacklinkSyncCoordinator()
		let runAttempt: Parameters<typeof coordinator.run>[1] = async attempt => {
			attempts.push(attempt.content)
			if (attempts.length === 1) throw new Error("sync failed")
			return {
				status: "synced",
				currentLinkIds: getWikilinkIds(attempt.content),
			}
		}
		let session = coordinator.openSession("doc-a", "")
		coordinator.setReady(session, true)
		coordinator.queue(session, "[[target]]")

		await expect(coordinator.run(session, runAttempt)).resolves.toBeUndefined()
		expect(attempts).toEqual(["[[target]]"])

		await coordinator.run(session, runAttempt)
		expect(attempts).toEqual(["[[target]]", "[[target]]"])
	})

	test("does not let a stale session failure block the active session", async () => {
		let delayed = makeDeferred()
		let attempts: string[] = []
		let coordinator = createBacklinkSyncCoordinator()
		let runAttempt: Parameters<typeof coordinator.run>[1] = async attempt => {
			attempts.push(attempt.sourceId)
			if (attempt.sourceId === "doc-a") {
				await delayed.promise
				throw new Error("stale sync failed")
			}
			return {
				status: "synced",
				currentLinkIds: getWikilinkIds(attempt.content),
			}
		}

		let sessionA = coordinator.openSession("doc-a", "")
		coordinator.setReady(sessionA, true)
		coordinator.queue(sessionA, "[[target-a]]")
		let runA = coordinator.run(sessionA, runAttempt)
		await Promise.resolve()

		let sessionB = coordinator.openSession("doc-b", "")
		coordinator.setReady(sessionB, true)
		coordinator.queue(sessionB, "[[target-b]]")
		let runB = coordinator.run(sessionB, runAttempt)
		delayed.resolve()

		await expect(Promise.all([runA, runB])).resolves.toEqual([
			undefined,
			undefined,
		])
		expect(attempts).toEqual(["doc-a", "doc-b"])
	})
})

function makeDeferred() {
	let resolvePromise: (() => void) | undefined
	let promise = new Promise<void>(resolve => {
		resolvePromise = resolve
	})

	return {
		promise,
		resolve() {
			resolvePromise?.()
		},
	}
}
