import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import { encode } from "../../src/shared/base64"
import { Replica } from "../../src/shared/crdt"
import { DocumentConflict, restoreSnapshot } from "./document"
import type { DocumentSnapshot } from "./document"

export function documentReplica(
	document: string,
	session: string,
	snapshot?: DocumentSnapshot,
) {
	return Effect.gen(function* () {
		if (snapshot && snapshot.document !== document)
			return yield* Effect.fail(
				new DocumentConflict({
					message: "Snapshot belongs to another document",
				}),
			)
		let crypto = yield* Crypto.Crypto
		let identity = new TextEncoder().encode(JSON.stringify([session, document]))
		let actor = encode(yield* crypto.digest("SHA-256", identity))
		return snapshot
			? yield* restoreSnapshot(snapshot, actor)
			: new Replica(actor)
	})
}
