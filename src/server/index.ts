import * as HttpClient from "effect/http/HttpClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { resolve } from "node:path"
import { Cipher } from "../platform/cipher"
import { webCryptoLayer } from "../platform/web-crypto"
import { attempt, promise } from "../platform/effects"
import type { Connection } from "./application"
import { AgentCredentials } from "./agent-credentials"
import { AccountApplication } from "./account-api"
import { RequestOrigin, requestOriginLayer } from "./request-origin"
import { WorkspaceStore } from "./document-store"
import { Sessions } from "./sessions"
import { Application } from "./application"
import { AgentStore } from "./agent-store"
import type { ServerOptions } from "./settings"
import { RelaySecrets, RelaySettings } from "./settings"

export class BunServer extends Context.Service<
	BunServer,
	Effect.Success<ReturnType<typeof serve>>
>()("BunServer") {
	static layer = Layer.effect(BunServer, serve())
}
export function serverLayer(options: ServerOptions = {}) {
	let settings = RelaySettings.layer(options)
	let secrets = RelaySecrets.layer.pipe(
		Layer.provideMerge(Layer.merge(settings, Cipher.live)),
	)
	let store = Layer.unwrap(
		Effect.gen(function* () {
			let settings = yield* RelaySettings
			return AgentStore.layer(resolve(settings.data, "relay.sqlite"))
		}),
	).pipe(Layer.provideMerge(secrets))
	let sessions = Layer.unwrap(
		Effect.gen(function* () {
			let settings = yield* RelaySettings
			return Sessions.layer(resolve(settings.data, "accounts.sqlite"))
		}),
	).pipe(Layer.provideMerge(secrets))
	let origins = requestOriginLayer.pipe(Layer.provideMerge(sessions))
	let documents = Layer.unwrap(
		Effect.gen(function* () {
			let settings = yield* RelaySettings
			return WorkspaceStore.layer(resolve(settings.data, "documents.sqlite"))
		}),
	).pipe(Layer.provideMerge(origins))
	let credentials = AgentCredentials.layer.pipe(
		Layer.provideMerge(Layer.merge(store, documents)),
	)
	let account = AccountApplication.layer.pipe(
		Layer.provideMerge(Layer.merge(documents, credentials)),
	)
	let application = Application.layer.pipe(
		Layer.provideMerge(Layer.merge(credentials, account)),
		Layer.provideMerge(FetchHttpClient.layer),
		Layer.provideMerge(webCryptoLayer),
	)
	return BunServer.layer.pipe(Layer.provideMerge(application))
}
export function startServer(options: ServerOptions = {}) {
	return Effect.gen(function* () {
		let runtime = ManagedRuntime.make(serverLayer(options))
		let resource = yield* promise("server.start", () =>
			runtime.runPromise(BunServer),
		).pipe(Effect.onError(() => runtime.disposeEffect))
		return { ...resource, close: () => runtime.disposeEffect }
	})
}
function serve() {
	return Effect.gen(function* () {
		let settings = yield* RelaySettings
		let application = yield* Application
		let origin = yield* RequestOrigin
		let runRequest = yield* FiberSet.makeRuntimePromise<HttpClient.HttpClient>()
		let server = yield* Effect.acquireRelease(
			attempt("server.listen", () =>
				Bun.serve<Connection>({
					port: settings.port,
					hostname: settings.hostname,
					maxRequestBodySize: 12000000,
					fetch(request, server) {
						return runRequest(application.handleRequest(request, server), {
							signal: request.signal,
						})
					},
					websocket: application.websocket,
				}),
			),
			server =>
				promise("server.stop", () => server.stop(true)).pipe(Effect.orDie),
		)
		yield* origin.bind(server.url.origin)
		return {
			server,
			database: application.database,
			cipher: application.cipher,
			mcp: application.mcp,
			documents: application.documents,
		}
	})
}
if (import.meta.main) {
	let application = Layer.effectDiscard(
		Effect.gen(function* () {
			let { server } = yield* BunServer
			console.log(`Alkalye: ${server.url}`)
		}),
	).pipe(Layer.provide(serverLayer()))
	let fiber = Effect.runFork(Layer.launch(application))
	for (let signal of ["SIGINT", "SIGTERM"])
		process.once(signal, () => {
			void Effect.runPromise(Fiber.interrupt(fiber)).then(() => process.exit(0))
		})
}
