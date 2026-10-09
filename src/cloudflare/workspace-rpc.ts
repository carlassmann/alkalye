import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as Schema from "effect/Schema"
import * as SqlError from "effect/sql/SqlError"
import { Identity } from "../shared/workspace"
import { WorkspaceApi } from "./workspace-api"

export type WorkspaceRequest = (
	workspace: string,
	identity: Identity["Service"],
	request: Request,
) => Promise<Response>
export function workspaceRpc<A, S extends Schema.Top>(
	request: WorkspaceRequest,
	workspace: string,
	identity: Identity["Service"],
	send: (client: WorkspaceClient) => Effect.Effect<A, unknown>,
	errors: S,
): Effect.Effect<A, S["Type"] | SqlError.SqlError> {
	return makeClient().pipe(
		Effect.flatMap(send),
		Effect.provideService(
			FetchHttpClient.Fetch,
			privateFetch(request, workspace, identity),
		),
		Effect.catch(error =>
			Effect.fail<S["Type"] | SqlError.SqlError>(
				Schema.is(errors)(error)
					? error
					: new SqlError.SqlError({
							reason: new SqlError.UnknownError({
								cause: error,
								message: "Workspace storage binding unavailable",
							}),
						}),
			),
		),
	)
}
function makeClient() {
	return HttpApiClient.make(WorkspaceApi, {
		baseUrl: "https://workspace.internal",
	}).pipe(Effect.provide(FetchHttpClient.layer))
}
function privateFetch(
	request: WorkspaceRequest,
	workspace: string,
	identity: Identity["Service"],
) {
	return Object.assign(
		(input: RequestInfo | URL, init?: RequestInit) => {
			// RPC cannot transfer an AbortSignal; interrupted callers retain unknown receipts.
			let { signal: _signal, ...requestInit } = init ?? {}
			return request(workspace, identity, new Request(input, requestInit))
		},
		{ preconnect() {} },
	)
}
export type WorkspaceClient = Effect.Success<ReturnType<typeof makeClient>>
