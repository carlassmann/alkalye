import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SqlError from "effect/sql/SqlError"
import { WorkspaceStore } from "../server/document-store"
import {
	PermissionDenied,
	ResourceUnavailable,
} from "../shared/document-actions"
import { verifyBlobChunk } from "../shared/document-blobs"
import { BlobCorrupt, BlobQuotaExceeded } from "../shared/document-errors"
import { Identity } from "../shared/workspace"
import { CloudflareBlobBudget } from "./blob-budget"
import { WorkspaceDirectory } from "./workspace-directory"
import type { WorkspaceRoute } from "./workspace-directory"
import { workspaceRpc } from "./workspace-rpc"
import type { WorkspaceRequest } from "./workspace-rpc"

type UploadFailure = Effect.Error<
	ReturnType<WorkspaceStore["Service"]["putBlob"]>
>

export function makeWorkspaceUploads(
	request: WorkspaceRequest,
	delegate: WorkspaceStore["Service"]["putBlob"],
	resolveRoute?: (
		route: WorkspaceRoute,
	) => Effect.Effect<WorkspaceRoute, SqlError.SqlError>,
) {
	return Effect.gen(function* () {
		let budget = yield* CloudflareBlobBudget
		let directory = yield* WorkspaceDirectory
		let crypto = yield* Crypto.Crypto
		let upload: WorkspaceStore["Service"]["putBlob"] = (
			document,
			digest,
			input,
		) =>
			Identity.use(identity =>
				Effect.gen(function* () {
					let route = yield* directory.document(document)
					if (route && route.state !== "active" && resolveRoute)
						route = yield* resolveRoute(route)
					if (!route || route.state !== "active") {
						if (resolveRoute)
							return yield* Effect.fail(
								new ResourceUnavailable({
									message: "Document storage route is unavailable",
								}),
							)
						return yield* delegate(document, digest, input)
					}
					let bytes = new Uint8Array(input)
					let authorization = yield* workspaceRpc(
						request,
						route.workspace,
						identity,
						client =>
							client.internal.authorizeUpload({
								params: { document },
								payload: { digest, size: bytes.length },
							}),
						Schema.Union([
							PermissionDenied,
							ResourceUnavailable,
							BlobCorrupt,
							BlobQuotaExceeded,
						]),
					)
					yield* verifyBlobChunk(digest, bytes).pipe(
						Effect.provideService(Crypto.Crypto, crypto),
					)
					let reservation = yield* (
						authorization.missing ? budget.reserve : budget.importUsage
					)({
						document,
						digest,
						owner: authorization.owner,
						size: bytes.length,
					})
					yield* workspaceRpc(
						request,
						route.workspace,
						identity,
						client =>
							client.documents.putBlob({
								params: { document, digest },
								payload: bytes,
							}),
						Schema.Union([
							PermissionDenied,
							ResourceUnavailable,
							BlobCorrupt,
							BlobQuotaExceeded,
						]),
					).pipe(
						Effect.catch((error): Effect.Effect<never, UploadFailure> => {
							if (
								error instanceof PermissionDenied ||
								error instanceof ResourceUnavailable ||
								error instanceof BlobCorrupt ||
								error instanceof BlobQuotaExceeded
							)
								return budget
									.release(
										reservation,
										error instanceof BlobCorrupt
											? "invalidBytes"
											: "notCommitted",
									)
									.pipe(Effect.andThen(Effect.fail(error)))
							return Effect.fail(error)
						}),
					)
					yield* budget.confirm(reservation)
				}),
			)
		return upload
	})
}
