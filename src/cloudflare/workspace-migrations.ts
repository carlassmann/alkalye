import * as Effect from "effect/Effect"
import * as RcMap from "effect/RcMap"
import * as Semaphore from "effect/Semaphore"
import * as SqlError from "effect/sql/SqlError"
import { WorkspaceTransfers } from "../server/workspace-transfer"
import { WorkspaceDirectory } from "./workspace-directory"
import type { WorkspaceRoute } from "./workspace-directory"
import type { DeploymentEnvironment } from "./settings"

export function makeWorkspaceMigrations(environment: DeploymentEnvironment) {
	return Effect.gen(function* () {
		let directory = yield* WorkspaceDirectory
		let transfers = yield* WorkspaceTransfers
		let gates = yield* RcMap.make({
			lookup: (_workspace: string) => Semaphore.make(1),
		})
		return (route: WorkspaceRoute) =>
			Effect.scoped(
				Effect.gen(function* () {
					let gate = yield* RcMap.get(gates, route.workspace)
					return yield* gate.withPermits(1)(
						Effect.gen(function* () {
							let current = yield* directory.workspace(route.workspace)
							if (!current)
								return yield* unavailable("Workspace route disappeared")
							if (current.state === "active") return current
							if (current.state === "legacy")
								current = yield* directory.freezeWorkspace(
									current.workspace,
									current.generation,
								)
							yield* transfers.freezeWorkspace(
								current.workspace,
								current.generation,
							)

							let payload = yield* transfers.exportWorkspacePayload(
								current.workspace,
								current.generation,
							)

							let target = environment.WORKSPACES.get(
								environment.WORKSPACES.idFromName(current.workspace),
							)
							yield* Effect.tryPromise({
								try: async () => {
									let offset = 0
									let body = new ReadableStream<Uint8Array>({
										pull(controller) {
											if (offset === payload.length) return controller.close()
											let end = Math.min(offset + 256 * 1024, payload.length)
											controller.enqueue(payload.subarray(offset, end))
											offset = end
										},
									})
									let request = new Request(
										"https://workspace.internal/internal/workspace-import",
										{
											method: "POST",
											headers: { "Content-Type": "application/octet-stream" },
											body,
										},
									)

									let response = await target.importWorkspace(
										current.workspace,
										current.generation,
										request,
									)

									if (response.status !== 204)
										throw new Error("Workspace import was not acknowledged")
								},
								catch: () => connectionFailure(),
							})
							return yield* directory.activateWorkspace(
								current.workspace,
								current.generation,
							)
						}),
					)
				}),
			).pipe(
				Effect.mapError(error =>
					error instanceof SqlError.SqlError ? error : connectionFailure(),
				),
			)
	})
}

function unavailable(message: string) {
	return Effect.fail(
		new SqlError.SqlError({
			reason: new SqlError.UnknownError({
				operation: "workspace-migration",
				message,
				cause: new Error(message),
			}),
		}),
	)
}
function connectionFailure() {
	return new SqlError.SqlError({
		reason: new SqlError.ConnectionError({
			operation: "workspace-migration",
			message: "Workspace migration will resume on retry",
			cause: new Error("Workspace transfer interrupted"),
		}),
	})
}
