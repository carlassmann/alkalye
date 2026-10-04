import { expect, test } from "bun:test"
import { Replica } from "../src/shared/crdt"
import {
	commentRange,
	commentRanges,
	newComment,
	newDocument,
	records,
	selectionAnchor,
} from "../src/shared/documents"

test("captured comment identities follow the selected occurrence through intervening source edits", () => {
	let replica = new Replica("writer")
	newDocument(replica, "doc", "Untitled", "word and word")
	let captured = selectionAnchor(
		replica.visible("doc"),
		replica.text("doc"),
		"word",
		9,
	)
	replica.edit("doc", "Prefix word and word")
	replica.apply(
		newComment(
			replica,
			"comment",
			"doc",
			captured.quote,
			"About the second word",
			"Writer",
			undefined,
			captured,
		),
	)
	expect(commentRange(replica, "doc", replica.fields("comment"))).toEqual({
		start: 16,
		end: 20,
	})
	replica.edit("doc", "Prefix word and ")
	expect(
		commentRange(replica, "doc", replica.fields("comment")),
	).toBeUndefined()
})

test("captured anchors cover full Unicode text and distinguish frontmatter from body", () => {
	let replica = new Replica("writer")
	let source = "---\ntitle: Example\n---\n# 😀 discussion"
	newDocument(replica, "doc", "Untitled", source)
	let start = source.indexOf("😀")
	let captured = selectionAnchor(replica.visible("doc"), source, "😀", start)
	replica.apply(
		newComment(
			replica,
			"emoji",
			"doc",
			captured.quote,
			"Unicode",
			"Writer",
			undefined,
			captured,
		),
	)
	expect(commentRange(replica, "doc", replica.fields("emoji"))).toEqual({
		start,
		end: start + 2,
	})
	expect(captured.source).toBe("body")
	expect(
		selectionAnchor(
			replica.visible("doc"),
			source,
			"Example",
			source.indexOf("Example"),
		).source,
	).toBe("frontmatter")
})

test("current records read a cold checkpoint without loading event bodies or exposing mutable fields", () => {
	let replica = new Replica("writer")
	newDocument(replica, "doc", "Untitled", "quoted")
	replica.apply(
		newComment(replica, "comment", "doc", "quoted", "First", "Writer"),
	)
	replica.set("comment", "body", "Latest")
	let restored = new Replica("reader")
	restored.restore(replica.checkpoint())
	expect(restored.historyLoaded).toBe(false)
	let comments = records(restored, "comment")
	expect(comments).toHaveLength(1)
	expect(comments[0]?.fields.body).toBe("Latest")
	if (comments[0]) comments[0].fields.body = "Changed outside the replica"
	expect(restored.fields("comment").body).toBe("Latest")
	restored.set("comment", "type", "deleted")
	expect(records(restored, "comment")).toEqual([])
})

test("batch discussion ranges index source once and skip empty discussions", () => {
	let replica = new Replica("writer")
	newDocument(
		replica,
		"doc",
		"Untitled",
		"Prefix " + "x".repeat(10000) + " selected",
	)
	for (let index = 0; index < 50; index++)
		newComment(
			replica,
			"comment-" + index,
			"doc",
			"selected",
			"Comment " + index,
			"Writer",
		)
	let reads = 0
	let view = {
		text: replica.text.bind(replica),
		visible(target: string, until: number | string = Infinity) {
			reads++
			return replica.visible(target, until)
		},
	}
	let ranges = commentRanges(
		view,
		"doc",
		records(replica, "comment").map(comment => comment.fields),
	)
	expect(ranges).toHaveLength(50)
	expect(
		ranges.every(range => range?.start === 10008 && range.end === 10016),
	).toBe(true)
	expect(reads).toBe(1)
	expect(commentRanges(view, "doc", [])).toEqual([])
	expect(reads).toBe(1)
})
