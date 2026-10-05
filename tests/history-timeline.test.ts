import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import type { DocumentMoment } from "../src/shared/document-history"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { Replica } from "../src/shared/crdt"
import { buildAction, committedAction } from "../src/shared/document-actions"
import { historyDays, historyIndices } from "../src/client/history-timeline"

test("history day filters preserve accepted ordering and count whole-document actions", async () => {
	let replica = new Replica("timeline")
	let action = await Effect.runPromise(
		buildAction(replica, "doc", "Create", staged => [
			staged.set("doc", "type", "document"),
		]).pipe(
			Effect.flatMap(proposal => committedAction(replica, proposal, "owner")),
			Effect.provide(webCryptoLayer),
		),
	)
	let moments: DocumentMoment[] = [
		new Date(2026, 9, 4, 23, 59),
		new Date(2026, 9, 5, 0, 1),
		new Date(2026, 9, 5, 12),
	].map((date, index) => ({
		position: index + 1,
		action: {
			...action,
			changes: [
				{ ...action.changes[0], time: date.getTime() },
				...action.changes
					.slice(1)
					.map(change => ({ ...change, time: date.getTime() })),
			],
		},
	}))
	let days = historyDays(moments)
	expect(days.map(day => day.count)).toEqual([2, 1])
	expect(historyIndices(moments, days[0]?.value ?? "missing")).toEqual([1, 2])
	expect(historyIndices(moments, "")).toEqual([0, 1, 2])
	expect(historyIndices(moments, "missing")).toEqual([])
	expect(historyDays([])).toEqual([])
})
