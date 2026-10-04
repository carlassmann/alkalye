import * as Effect from "effect/Effect"
import { CausalDependencyMissing, DocumentConflict } from "./document-errors"
import { partitionTextOperations } from "./text-dependencies"
import type { Replica } from "./crdt"
import type { Operation } from "./model"

export function validateTextCausality(
	replica: Pick<Replica, "atomTarget" | "textOperationTarget">,
	document: string,
	changes: readonly Operation[],
) {
	return Effect.gen(function* () {
		let partition = yield* partitionTextOperations(replica, changes)
		let rejected = partition.rejected[0]
		if (rejected?.reason === "AnchorCycle")
			return yield* new DocumentConflict({ message: rejected.message })
		let missing = rejected ?? partition.missing[0]
		if (missing)
			return yield* new CausalDependencyMissing({
				document,
				target: missing.target,
				atom: missing.atom,
				message:
					missing.kind === "contribution"
						? "This cancellation depends on a text contribution that has not been accepted"
						: "This text action depends on an atom that has not been accepted",
			})
	})
}
