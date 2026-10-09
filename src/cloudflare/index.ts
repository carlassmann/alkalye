import { DurableObject } from "cloudflare:workers"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { Cipher } from "../platform/cipher"
import { cloudflareSqliteLayer } from "../platform/cloudflare-sqlite"
import { cloudflareBlobObjectsLayer } from "../platform/cloudflare-blob-objects"
import { webCryptoLayer } from "../platform/web-crypto"
import { AccountApplication } from "../server/account-api"
import { AgentCredentials } from "../server/agent-credentials"
import { AgentStore } from "../server/agent-store"
import { Application } from "../server/application"
import { WorkspaceStore } from "../server/document-store"
import { EmailAuthentication } from "../server/email-authentication"
import { EmailDelivery } from "../server/email-delivery"
import { RequestOrigin, requestOriginLayer } from "../server/request-origin"
import { Sessions } from "../server/sessions"
import { DocumentObservability } from "../shared/document-observability"
import { cloudflareAsset, cloudflareAssetsLayer } from "./assets"
import { cloudflareClientMetadataLayer } from "./client-metadata"
import { makeCloudflareLiveServer } from "./live"
import { cloudflareSecretsLayer, cloudflareSettingsLayer } from "./settings"
import type { DeploymentEnvironment } from "./settings"

function relayLayer(
	storage: DurableObjectStorage,
	environment: DeploymentEnvironment,
) {
	let database = cloudflareSqliteLayer(storage)
	let stores = Layer.mergeAll(
		AgentStore.live,
		Sessions.live,
		WorkspaceStore.live,
		EmailAuthentication.live,
	).pipe(Layer.provideMerge(database))
	let credentials = AgentCredentials.layer.pipe(Layer.provideMerge(stores))
	let accounts = AccountApplication.layer.pipe(Layer.provideMerge(credentials))
	return Application.layer.pipe(
		Layer.provideMerge(accounts),
		Layer.provideMerge(cloudflareBlobObjectsLayer(environment.ASSETS_BUCKET)),
		Layer.provideMerge(requestOriginLayer),
		Layer.provideMerge(EmailDelivery.layer),
		Layer.provideMerge(cloudflareAssetsLayer(environment.ASSETS)),
		Layer.provideMerge(cloudflareClientMetadataLayer),
		Layer.provideMerge(cloudflareSecretsLayer(environment)),
		Layer.provideMerge(Cipher.live),
		Layer.provideMerge(cloudflareSettingsLayer(environment)),
		Layer.provideMerge(DocumentObservability.layer("server")),
		Layer.provideMerge(FetchHttpClient.layer),
		Layer.provideMerge(webCryptoLayer),
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					NODE_ENV: "production",
					RESEND_API_KEY: environment.RESEND_API_KEY,
					EMAIL_FROM: environment.EMAIL_FROM ?? "",
				}),
			),
		),
	)
}

export class AlkalyeRelay extends DurableObject<DeploymentEnvironment> {
	private runtime
	private ready

	constructor(context: DurableObjectState, environment: DeploymentEnvironment) {
		super(context, environment)
		this.runtime = ManagedRuntime.make(relayLayer(context.storage, environment))
		this.ready = context.blockConcurrencyWhile(() =>
			this.runtime.runPromise(
				Effect.gen(function* () {
					let application = yield* Application
					return {
						application,
						server: makeCloudflareLiveServer(application.websocket),
						origin: yield* RequestOrigin,
					}
				}),
			),
		)
	}

	async fetch(request: Request) {
		let { application, server, origin } = await this.ready
		await this.runtime.runPromise(origin.bind(new URL(request.url).origin))
		let response = await this.runtime.runPromise(
			application.handleRequest(request, server),
			{ signal: request.signal },
		)
		return response ?? new Response("Upgrade failed", { status: 500 })
	}
}

export default {
	fetch(request: Request, environment: DeploymentEnvironment) {
		let path = new URL(request.url).pathname
		if (
			!path.startsWith("/api/") &&
			!path.startsWith("/oauth/") &&
			!path.startsWith("/.well-known/") &&
			path !== "/mcp" &&
			path !== "/sync"
		)
			return Effect.runPromise(cloudflareAsset(request, environment.ASSETS), {
				signal: request.signal,
			})
		let relay = environment.RELAY.get(environment.RELAY.idFromName("primary"))
		return relay.fetch(request)
	},
} satisfies ExportedHandler<DeploymentEnvironment>
