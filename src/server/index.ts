import {
	agentStoreLayer,
	sessionsLayer,
	emailAuthenticationLayer,
	workspaceStoreLayer,
} from "./bun-databases"
import { bunEmailDeliveryLayer } from "./bun-email-delivery"
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
import { DocumentObservability } from "../shared/document-observability"
import { Application } from "./application"
import { bunAssetsLayer } from "./bun-assets"
import type { ServerOptions } from "./settings"
import { RelaySettings } from "./settings"
import { bunSettingsLayer, bunSecretsLayer } from "./bun-settings"
import { bunClientMetadataLayer } from "./bun-client-metadata"

export class BunServer extends Context.Service<
	BunServer,
	Effect.Success<ReturnType<typeof serve>>
>()("BunServer") {
	static layer = Layer.effect(BunServer, serve())
}
export function serverLayer(options: ServerOptions = {}) {
	let settings = bunSettingsLayer(options)
	let secrets = bunSecretsLayer.pipe(
		Layer.provideMerge(Layer.merge(settings, Cipher.live)),
	)
	let store = Layer.unwrap(
		Effect.gen(function* () {
			let settings = yield* RelaySettings
			return agentStoreLayer(resolve(settings.data, "relay.sqlite"))
		}),
	).pipe(Layer.provideMerge(secrets))
	let sessions = Layer.unwrap(
		Effect.gen(function* () {
			let settings = yield* RelaySettings
			return sessionsLayer(resolve(settings.data, "accounts.sqlite"))
		}),
	).pipe(Layer.provideMerge(secrets))
	let emails = Layer.unwrap(
		Effect.gen(function* () {
			let settings = yield* RelaySettings
			return emailAuthenticationLayer(resolve(settings.data, "email.sqlite"))
		}),
	).pipe(Layer.provideMerge(Layer.merge(sessions, bunEmailDeliveryLayer)))
	let origins = requestOriginLayer.pipe(Layer.provideMerge(emails))
	let documents = Layer.unwrap(
		Effect.gen(function* () {
			let settings = yield* RelaySettings
			return workspaceStoreLayer(resolve(settings.data, "documents.sqlite"))
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
		Layer.provideMerge(bunAssetsLayer.pipe(Layer.provide(settings))),
		Layer.provideMerge(FetchHttpClient.layer),
		Layer.provideMerge(webCryptoLayer),
		Layer.provideMerge(bunClientMetadataLayer),
	)
	return BunServer.layer.pipe(
		Layer.provideMerge(application),
		Layer.provideMerge(DocumentObservability.layer("server")),
	)
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
		let observability = yield* DocumentObservability
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
			diagnostics: observability.snapshot,
			database: application.database,
			cipher: application.cipher,
			mcp: application.mcp,
			documents: application.documents,
			liveSessions: application.liveSessions,
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
