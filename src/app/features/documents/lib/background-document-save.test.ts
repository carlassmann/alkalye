import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	createJazzTestAccount,
	setActiveAccount,
	setupJazzTestSync,
} from "jazz-tools/testing"
import type { co } from "jazz-tools"
import { Document, UserAccount } from "@/schema"
import { createCommentThread, getCommentRange } from "@/app/features/comments"
import {
	acceptDocumentInvite,
	createDocumentInvite,
	parseInviteLink,
} from "@/app/features/sharing/lib/document-sharing"
import { createPersonalDocument } from "./documents"
import { calculateDocumentContentPatches } from "./document-diff"
import { mergeDocumentContent } from "./merge-document-content"
import {
	createBackgroundDocumentSave,
	persistDocumentContentSynchronously,
} from "./background-document-save"
import type {
	DocumentSaveWorkerRequest,
	DocumentSaveWorkerResponse,
} from "./document-save-protocol"

describe("background document save", () => {
	let account: co.loaded<typeof UserAccount>

	beforeEach(async () => {
		await setupJazzTestSync()
		account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		FakeWorker.instances = []
		vi.stubGlobal("Worker", FakeWorker)
	})

	afterEach(() => vi.unstubAllGlobals())

	test("preserves a concurrent edit instead of overwriting it", async () => {
		let doc = await createPersonalDocument(account, "Original")
		let save = createBackgroundDocumentSave(() => doc)
		let result = save.save("Replacement")
		let worker = await currentWorkerWithDiff()

		doc.content.insertBefore(doc.content.length, " remote")
		worker.completeDiff(0)
		await vi.waitFor(() => expect(worker.diffRequests()).toHaveLength(2))
		worker.completeDiff(1)

		await expect(result).resolves.toBe("Replacement remote")
		expect(doc.content.toString()).toBe("Replacement remote")
		save.close()
	})

	test("rebases queued local edits after a concurrent remote edit", async () => {
		let doc = await createPersonalDocument(account, "Start end")
		let save = createBackgroundDocumentSave(() => doc)
		let first = save.save("Start local end", "Start end")
		let second = save.save("Start local again end", "Start local end")
		let worker = await currentWorkerWithDiff()

		doc.content.insertBefore(doc.content.length, " remote")
		worker.completeDiff(0)
		await vi.waitFor(() => expect(worker.diffRequests()).toHaveLength(2))
		worker.completeDiff(1)
		await expect(first).resolves.toBe("Start local end remote")

		await vi.waitFor(() => expect(worker.diffRequests()).toHaveLength(3))
		worker.completeDiff(2)
		await expect(second).resolves.toBe("Start local again end remote")
		expect(doc.content.toString()).toBe("Start local again end remote")
		save.close()
	})

	test("continues queued saves after one diff fails", async () => {
		let doc = await createPersonalDocument(account, "Original")
		let save = createBackgroundDocumentSave(() => doc)
		let failed = save.save("Broken")
		let applied = save.save("Recovered")
		let worker = await currentWorkerWithDiff()

		worker.failDiff("diff failed")
		await expect(failed).rejects.toThrow("diff failed")
		await vi.waitFor(() => expect(worker.diffRequests()).toHaveLength(2))
		worker.completeDiff(1)

		await expect(applied).resolves.toBe("Recovered")
		expect(doc.content.toString()).toBe("Recovered")
		save.close()
	})

	test("rejects pending and future saves after the worker dies", async () => {
		let doc = await createPersonalDocument(account, "Original")
		let save = createBackgroundDocumentSave(() => doc)
		let pending = save.save("Replacement")
		let worker = await currentWorkerWithDiff()

		worker.crash()

		await expect(pending).rejects.toThrow("worker crashed")
		await expect(save.save("Later")).rejects.toThrow(
			"Background save is closed",
		)
	})

	test("drains an in-flight save before closing", async () => {
		let doc = await createPersonalDocument(account, "Original")
		let save = createBackgroundDocumentSave(() => doc)
		let pending = save.save("Replacement")
		let worker = await currentWorkerWithDiff()

		save.close()
		expect(worker.closeRequests()).toHaveLength(0)
		worker.completeDiff()

		await expect(pending).resolves.toBe("Replacement")
		await vi.waitFor(() => expect(worker.closeRequests()).toHaveLength(1))
		expect(doc.content.toString()).toBe("Replacement")
		await expect(save.save("Later")).rejects.toThrow(
			"Background save is closed",
		)
	})

	test("uses the append path without waiting for the worker", async () => {
		let doc = await createPersonalDocument(account, "# Draft")
		let save = createBackgroundDocumentSave(() => doc)

		await expect(save.save("# Draft\n\nContinued")).resolves.toBe(
			"# Draft\n\nContinued",
		)

		expect(FakeWorker.instances[0]?.diffRequests()).toHaveLength(0)
		expect(doc.content.toString()).toBe("# Draft\n\nContinued")
		expect(doc.title).toBe("Draft")
		save.close()
	})

	test("preserves comment anchors through worker-generated patches", async () => {
		let doc = await createPersonalDocument(
			account,
			"Before commented text after",
		)
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true } },
		})
		let thread = createCommentThread(loaded, { from: 7, to: 21 }, "Note")
		if (!thread) throw new Error("Comment not created")
		let save = createBackgroundDocumentSave(() => loaded)
		let pending = save.save("Prefix Before commented revised text after")
		let worker = await currentWorkerWithDiff()

		worker.completeDiff()

		await expect(pending).resolves.toBe(
			"Prefix Before commented revised text after",
		)
		expect(loaded.content.toString()).toBe(
			"Prefix Before commented revised text after",
		)
		expect(getCommentRange(loaded, thread.anchor)).toEqual({
			from: 14,
			to: 36,
			orphaned: false,
		})
		save.close()
	})

	test("rejects patches that do not produce the requested content", async () => {
		let doc = await createPersonalDocument(account, "Original")
		let save = createBackgroundDocumentSave(() => doc)
		let pending = save.save("Replacement")
		let worker = await currentWorkerWithDiff()
		let request = worker.diffRequests()[0]
		if (!request || request.type !== "diff") {
			throw new Error("Missing diff request")
		}

		worker.respond({
			type: "diffed",
			requestId: request.requestId,
			content: request.newContent,
			patches: [],
		})

		await expect(pending).rejects.toThrow(
			"Document diff did not produce the requested content",
		)
		expect(doc.content.toString()).toBe("Original")
		save.close()
	})

	test("saves while comment anchors are still loading", async () => {
		let collaborator = await createJazzTestAccount({
			isCurrentActiveAccount: false,
			AccountSchema: UserAccount,
		})
		setActiveAccount(account)
		let doc = await createPersonalDocument(account, "Original")
		let invite = await createDocumentInvite(doc, "writer")
		await acceptDocumentInvite(collaborator, parseInviteLink(invite.link))

		setActiveAccount(collaborator)
		let shallowDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		if (!shallowDoc.$isLoaded) throw new Error("Document not loaded")
		expect(shallowDoc.comments?.$isLoaded).toBe(false)
		let save = createBackgroundDocumentSave(() => shallowDoc)
		let pending = save.save("Replacement")
		let worker = await currentWorkerWithDiff()

		worker.completeDiff()

		await expect(pending).resolves.toBe("Replacement")
		expect(shallowDoc.content.toString()).toBe("Replacement")
		save.close()
	})

	test("synchronous persistence keeps content and sidebar metadata aligned", async () => {
		let doc = await createPersonalDocument(account, "# Draft")

		persistDocumentContentSynchronously(
			doc,
			"---\ntags: finished\n---\n\n# Final\n\nBody",
		)

		expect(doc.content.toString()).toContain("# Final")
		expect(doc.title).toBe("Final")
		expect(doc.tags).toEqual(["finished"])
		expect(doc.contentUpdatedAt?.getTime()).toBe(doc.updatedAt.getTime())
		expect(doc.metadataUpdatedAt?.getTime()).toBe(doc.updatedAt.getTime())
	})

	test("synchronously replaces content spanning multiple transaction chunks", async () => {
		let doc = await createPersonalDocument(account, "x".repeat(3_500))

		persistDocumentContentSynchronously(doc, "# Replaced")

		expect(doc.content.toString()).toBe("# Replaced")
	})

	test("synchronously appends pending content before the page closes", async () => {
		let doc = await createPersonalDocument(account, "")
		let stale = new Date("2020-01-01T00:00:00Z")
		doc.$jazz.set("updatedAt", stale)
		doc.$jazz.set("contentUpdatedAt", stale)
		doc.$jazz.set("metadataUpdatedAt", stale)

		persistDocumentContentSynchronously(doc, "# Final\n\nLast line")

		expect(doc.content.toString()).toBe("# Final\n\nLast line")
		expect(doc.title).toBe("Final")
		expect(doc.updatedAt.getTime()).toBeGreaterThan(stale.getTime())
		expect(doc.contentUpdatedAt?.getTime()).toBe(doc.updatedAt.getTime())
		expect(doc.metadataUpdatedAt?.getTime()).toBe(doc.updatedAt.getTime())
	})
})

class FakeWorker extends EventTarget {
	static instances: FakeWorker[] = []
	messages: DocumentSaveWorkerRequest[] = []

	constructor() {
		super()
		FakeWorker.instances.push(this)
	}

	postMessage(message: DocumentSaveWorkerRequest) {
		this.messages.push(message)
	}

	terminate() {}

	diffRequests() {
		return this.messages.filter(message => message.type === "diff")
	}

	closeRequests() {
		return this.messages.filter(message => message.type === "close")
	}

	completeDiff(index = 0) {
		let request = this.diffRequests()[index]
		if (!request || request.type !== "diff") {
			throw new Error(`Missing diff request ${index}`)
		}
		let oldContent = request.oldEntries.join("")
		let content = mergeDocumentContent(
			request.baseContent,
			request.newContent,
			oldContent,
		)
		this.respond({
			type: "diffed",
			requestId: request.requestId,
			content,
			patches: calculateDocumentContentPatches(request.oldEntries, content),
		})
	}

	failDiff(message: string, index = 0) {
		let request = this.diffRequests()[index]
		if (!request || request.type !== "diff") {
			throw new Error(`Missing diff request ${index}`)
		}
		this.respond({ type: "failed", requestId: request.requestId, message })
	}

	crash() {
		this.dispatchEvent(new ErrorEvent("error", { message: "worker crashed" }))
	}

	respond(response: DocumentSaveWorkerResponse) {
		this.dispatchEvent(new MessageEvent("message", { data: response }))
	}
}

async function currentWorkerWithDiff() {
	await vi.waitFor(() => {
		expect(FakeWorker.instances[0]?.diffRequests()).toHaveLength(1)
	})
	let worker = FakeWorker.instances[0]
	if (!worker) throw new Error("Worker not created")
	return worker
}
