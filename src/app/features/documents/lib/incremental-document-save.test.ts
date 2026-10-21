import { beforeEach, describe, expect, test, vi } from "vitest"
import { EditorState, type ChangeSpec } from "@codemirror/state"
import { co } from "jazz-tools"
import {
	createJazzTestAccount,
	setActiveAccount,
	setupJazzTestSync,
} from "jazz-tools/testing"
import { Document, UserAccount } from "@/schema"
import { createCommentThread, getCommentRange } from "@/app/features/comments"
import {
	acceptDocumentInvite,
	createDocumentInvite,
	parseInviteLink,
} from "@/app/features/sharing/lib/document-sharing"
import { createPersonalDocument } from "./documents"
import { persistDocumentContentSynchronously } from "./background-document-save"
import {
	captureDocumentSaveBase,
	composeDocumentEdits,
	persistDocumentEdits,
	type DocumentEdits,
	type DocumentSaveBase,
} from "./incremental-document-save"
import { readDocumentText } from "./document-text"

describe("incremental document saves", () => {
	let account: co.loaded<typeof UserAccount>
	beforeEach(async () => {
		await setupJazzTestSync()
		account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
	})

	test("composes typing, replacement, undo and redo across the quiet period", async () => {
		let doc = await createPersonalDocument(account, "Start end")
		let base = captureDocumentSaveBase(doc)
		let first = edit(base, { from: 6, insert: "local " })
		let second = edit(base, { from: 6, to: 11, insert: "again" }, first)
		let undo = edit(base, { from: 6, to: 11, insert: "local" }, second)
		let redo = edit(base, { from: 6, to: 11, insert: "again" }, undo)
		expect(persistDocumentEdits(doc, redo)).toBe("Start again end")
		expect(doc.content.toString()).toBe("Start again end")
		expect(readDocumentText(doc.content)).toBe(doc.content.toString())
	})

	test("preserves a remote insertion inside the locally replaced range", async () => {
		let doc = await createPersonalDocument(account, "Start old end")
		let base = captureDocumentSaveBase(doc)
		let pending = edit(base, { from: 6, to: 9, insert: "new" })
		doc.content.insertBefore(7, " remote ")
		expect(persistDocumentEdits(doc, pending)).toBe("Start  remote new end")
		expect(doc.content.toString()).toBe("Start  remote new end")
	})

	test("concurrent writers converge when the remote edit arrives during debounce", async () => {
		let collaborator = await createJazzTestAccount({
			isCurrentActiveAccount: false,
			AccountSchema: UserAccount,
		})
		setActiveAccount(account)
		let doc = await createPersonalDocument(account, "Start end")
		let invite = await createDocumentInvite(doc, "writer")
		await acceptDocumentInvite(collaborator, parseInviteLink(invite.link))
		setActiveAccount(collaborator)
		let peer = await Document.load(doc.$jazz.id, { resolve: { content: true } })
		if (!peer.$isLoaded) throw new Error("Peer did not load")
		let localBase = captureDocumentSaveBase(doc)
		let peerBase = captureDocumentSaveBase(peer)
		let pending = edit(localBase, { from: 6, insert: "local " })
		let remote = edit(peerBase, { from: 9, insert: " remote" })
		expect(persistDocumentEdits(peer, remote)).toBe("Start end remote")
		await vi.waitFor(() =>
			expect(doc.content.toString()).toBe("Start end remote"),
		)
		expect(persistDocumentEdits(doc, pending)).toBe("Start local end remote")
		await vi.waitFor(() =>
			expect(peer.content.toString()).toBe("Start local end remote"),
		)
	})

	test("keeps the order of multiple ranges when remote deletion collapses their anchors", async () => {
		let doc = await createPersonalDocument(account, "abcdefg")
		let pending = edit(captureDocumentSaveBase(doc), [
			{ from: 1, to: 2, insert: "XX" },
			{ from: 3, to: 4, insert: "YY" },
		])
		doc.content.deleteRange({ from: 1, to: 4 })
		expect(persistDocumentEdits(doc, pending)).toBe("aXXYYefg")
		expect(doc.content.toString()).toBe("aXXYYefg")
	})

	test("maps the next debounce batch against the saved remote and local text", async () => {
		let doc = await createPersonalDocument(account, "abcdefgh")
		let base = captureDocumentSaveBase(doc)
		let first = edit(base, [
			{ from: 1, to: 2, insert: "X" },
			{ from: 5, to: 6, insert: "Y" },
		])
		let second = edit(base, { from: 2, insert: "Z" }, first)
		doc.content.insertBefore(3, "REMOTE")
		expect(persistDocumentEdits(doc, second)).toBe("aXZcREMOTEdeYgh")
		let next = edit(captureDocumentSaveBase(doc), {
			from: 3,
			to: 12,
			insert: "NEXT",
		})
		expect(persistDocumentEdits(doc, next)).toBe("aXZNEXTYgh")
		expect(readDocumentText(doc.content)).toBe(doc.content.toString())
	})

	test("falls back without partially writing when both neighbours disappear", async () => {
		let doc = await createPersonalDocument(account, "abcdef")
		let pending = edit(captureDocumentSaveBase(doc), [
			{ from: 1, insert: "X" },
			{ from: 4, insert: "Y" },
		])
		doc.content.deleteRange({ from: 3, to: 5 })
		expect(persistDocumentEdits(doc, pending)).toBeUndefined()
		expect(doc.content.toString()).toBe("abcf")
	})

	test("keeps loaded comment anchors through positioned edits", async () => {
		let doc = await createPersonalDocument(
			account,
			"Before commented text after",
		)
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true } },
		})
		let thread = createCommentThread(loaded, { from: 7, to: 21 }, "Note")
		if (!thread) throw new Error("Comment not created")
		let pending = edit(captureDocumentSaveBase(loaded), [
			{ from: 0, insert: "Prefix " },
			{ from: 17, insert: "revised " },
		])
		expect(persistDocumentEdits(loaded, pending)).toBe(
			"Prefix Before commented revised text after",
		)
		expect(getCommentRange(loaded, thread.anchor)).toEqual({
			from: 14,
			to: 36,
			orphaned: false,
		})
	})

	test.each(["A😀B", "Ae\u0301B", "A👨‍👩‍👧‍👦B", "A\r\nB"])(
		"maps UTF-16 offsets for %j",
		async content => {
			let doc = await createPersonalDocument(account, content)
			let base = captureDocumentSaveBase(doc)
			let pending = edit(base, {
				from: content.replace(/\r\n?/g, "\n").length - 1,
				insert: "x",
			})
			expect(persistDocumentEdits(doc, pending)).toBe(
				content.slice(0, -1) + "xB",
			)
			expect(doc.content.toString()).toBe(content.slice(0, -1) + "xB")
		},
	)

	test("falls back for an edit inside a grapheme or a combining insertion", async () => {
		for (let [content, change] of [
			["Ae\u0301B", { from: 2, to: 3 }],
			["AeB", { from: 2, insert: "\u0301" }],
		] satisfies [string, ChangeSpec][]) {
			let doc = await createPersonalDocument(account, content)
			let base = captureDocumentSaveBase(doc)
			let pending = edit(base, change)
			expect(persistDocumentEdits(doc, pending)).toBeUndefined()
			let requested = pending.after.toString()
			expect(
				persistDocumentContentSynchronously(doc, requested, base.text),
			).toBe(requested)
			expect(doc.content.toString()).toBe(requested)
		}
	})

	test("falls back after generation replacement without writing the stale text", async () => {
		let doc = await createPersonalDocument(account, "Start end")
		let base = captureDocumentSaveBase(doc)
		let pending = edit(base, { from: 6, insert: "local " })
		doc.$jazz.set(
			"content",
			co.plainText().create("Start end remote", { owner: doc.$jazz.owner }),
		)
		expect(persistDocumentEdits(doc, pending)).toBeUndefined()
		expect(doc.content.toString()).toBe("Start end remote")
		expect(
			persistDocumentContentSynchronously(
				doc,
				pending.after.toString(),
				base.text,
			),
		).toBe("Start local end remote")
	})

	test("invalidates changes after an external editor replacement, even of equal length", async () => {
		let doc = await createPersonalDocument(account, "Start end")
		let base = captureDocumentSaveBase(doc)
		let pending = edit(base, { from: 6, insert: "local " })
		let external = EditorState.create({ doc: "Other local end" }).update({
			changes: { from: 0, insert: "!" },
		})
		expect(
			composeDocumentEdits(base, pending, {
				changes: external.changes,
				before: external.startState.doc,
				after: external.state.doc,
			}),
		).toBeUndefined()
		expect(
			composeDocumentEdits(base, undefined, {
				changes: external.changes,
				before: external.startState.doc,
				after: external.state.doc,
			}),
		).toBeUndefined()
	})

	test("does not reuse cached text after an external Jazz write", async () => {
		let doc = await createPersonalDocument(account, "Start")
		expect(readDocumentText(doc.content)).toBe("Start")
		doc.content.insertBefore(0, "New ")
		expect(readDocumentText(doc.content)).toBe("New Start")
	})

	test.each(["A😀B", "Ae\u0301B", "A\r\nB"])(
		"reuses the saved editor tree without flattening it again for %j",
		async content => {
			let doc = await createPersonalDocument(account, content)
			let first = edit(captureDocumentSaveBase(doc), { from: 0, insert: "x" })
			expect(persistDocumentEdits(doc, first)).toBe(`x${content}`)
			let state = EditorState.create({ doc: first.after })
			let next = state.update({ changes: { from: 0, insert: "y" } })
			let read = vi.spyOn(state.doc, "toString")
			let pending = composeDocumentEdits(
				captureDocumentSaveBase(doc),
				undefined,
				{
					changes: next.changes,
					before: state.doc,
					after: next.state.doc,
				},
			)
			expect(read).not.toHaveBeenCalled()
			read.mockRestore()
			if (!pending) throw new Error("Saved editor base was rejected")
			expect(persistDocumentEdits(doc, pending)).toBe(`yx${content}`)
			expect(doc.content.toString()).toBe(`yx${content}`)
		},
	)

	test("revalidates the saved editor tree after a remote write", async () => {
		let doc = await createPersonalDocument(account, "Start")
		let first = edit(captureDocumentSaveBase(doc), { from: 0, insert: "x" })
		persistDocumentEdits(doc, first)
		doc.content.insertBefore(0, "Remote ")
		let state = EditorState.create({ doc: first.after })
		let next = state.update({ changes: { from: 0, insert: "y" } })
		expect(
			composeDocumentEdits(captureDocumentSaveBase(doc), undefined, {
				changes: next.changes,
				before: state.doc,
				after: next.state.doc,
			}),
		).toBeUndefined()
		expect(doc.content.toString()).toBe("Remote xStart")
	})

	test("rejects a different editor tree with equal length after warming the cache", async () => {
		let doc = await createPersonalDocument(account, "Start")
		let first = edit(captureDocumentSaveBase(doc), { from: 0, insert: "x" })
		persistDocumentEdits(doc, first)
		let state = EditorState.create({ doc: "Other!" })
		let next = state.update({ changes: { from: 0, insert: "y" } })
		expect(
			composeDocumentEdits(captureDocumentSaveBase(doc), undefined, {
				changes: next.changes,
				before: state.doc,
				after: next.state.doc,
			}),
		).toBeUndefined()
		expect(doc.content.toString()).toBe("xStart")
	})
})

function edit(
	base: DocumentSaveBase,
	changes: ChangeSpec,
	previous?: DocumentEdits,
) {
	let state = EditorState.create({ doc: previous?.after ?? base.text })
	let transaction = state.update({ changes })
	let result = composeDocumentEdits(base, previous, {
		changes: transaction.changes,
		before: state.doc,
		after: transaction.state.doc,
	})
	if (!result) throw new Error("Changes did not compose")
	return result
}
