import { DurableObject } from "cloudflare:workers"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as HttpServer from "effect/http/HttpServer"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlSchema from "effect/sql/SqlSchema"
import { Cipher } from "../platform/cipher"
import { cloudflareBlobObjectsLayer } from "../platform/cloudflare-blob-objects"
import { cloudflareSqliteLayer } from "../platform/cloudflare-sqlite"
import { webCryptoLayer } from "../platform/web-crypto"
import { DocumentMaintenance, WorkspaceStore } from "../server/document-store"
import {
	WorkspaceTransfers,
	WorkspaceTransferCodec,
} from "../server/workspace-transfer"
import { requestOriginLayer } from "../server/request-origin"
import { DocumentObservability } from "../shared/document-observability"
import { IdentifierSchema } from "../shared/model"
import { AccessRoleSchema, Identity } from "../shared/workspace"
import { makeWorkspaceHandler } from "./workspace-api"
import { cloudflareSettingsLayer } from "./settings"
import type { DeploymentEnvironment } from "./settings"
import { WorkspaceNoticeSchema } from "./workspace-notices"

let delegatedIdentity = Schema.Struct({
	subject: IdentifierSchema,
	actors: Schema.Array(IdentifierSchema),
	access: Schema.optionalKey(
		Schema.Struct({
			workspaces: Schema.Union([
				Schema.Literal("all"),
				Schema.Array(IdentifierSchema),
			]),
			ceiling: AccessRoleSchema,
		}),
	),
})

function workspaceLayer(
	storage: DurableObjectStorage,
	environment: DeploymentEnvironment,
) {
	return Layer.effect(WorkspaceObject, makeWorkspaceObject()).pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				WorkspaceStore.live,
				DocumentMaintenance.live,
				WorkspaceTransfers.live,
			),
		),
		Layer.provideMerge(cloudflareSqliteLayer(storage)),
		Layer.provideMerge(cloudflareBlobObjectsLayer(environment.ASSETS_BUCKET)),
		Layer.provideMerge(HttpServer.layerServices),
		Layer.provideMerge(requestOriginLayer),
		Layer.provideMerge(DocumentObservability.layer("server")),
		Layer.provideMerge(Cipher.live),
		Layer.provideMerge(cloudflareSettingsLayer(environment)),
		Layer.provideMerge(webCryptoLayer),
	)
}

function makeWorkspaceObject() {
	return Effect.gen(function* () {
		let handler = yield* makeWorkspaceHandler()
		let sql = yield* SqlClient.SqlClient
		let transfers = yield* WorkspaceTransfers
		yield* sql`CREATE TABLE IF NOT EXISTS cloudflare_workspace_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), workspace TEXT NOT NULL)`
		yield* sql`CREATE TABLE IF NOT EXISTS cloudflare_workspace_outbox (position INTEGER PRIMARY KEY AUTOINCREMENT, notice TEXT NOT NULL)`
		let changes = yield* (yield* WorkspaceStore).changes
		let readBinding = SqlSchema.findOneOption({
			Request: Schema.Void,
			Result: Schema.Struct({ workspace: IdentifierSchema }),
			execute: () =>
				sql`SELECT workspace FROM cloudflare_workspace_identity WHERE singleton=1`,
		})
		let binding = yield* readBinding(undefined)
		function bind(workspace: string) {
			if (Option.isSome(binding))
				return Effect.succeed(
					binding.value.workspace === workspace ? binding : Option.none(),
				)
			return sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`INSERT INTO cloudflare_workspace_identity(singleton,workspace) VALUES(1,${workspace}) ON CONFLICT DO NOTHING`
					binding = yield* readBinding(undefined)
					return Option.filter(binding, value => value.workspace === workspace)
				}),
			)
		}
		function collect() {
			return Effect.gen(function* () {
				let notices = yield* PubSub.takeUpTo(changes, 64)
				for (let notice of notices) {
					let message =
						notice.kind === "workspace"
							? {
									...notice,
									subjects: Array.from(notice.subjects),
									documents: Array.from(notice.documents),
								}
							: { ...notice, subjects: Array.from(notice.subjects) }
					yield* sql`INSERT INTO cloudflare_workspace_outbox(notice) VALUES(${JSON.stringify(message)})`
				}
				return yield* SqlSchema.findAll({
					Request: Schema.Void,
					Result: Schema.Struct({
						position: Schema.Natural,
						notice: Schema.fromJsonString(WorkspaceNoticeSchema),
					}),
					execute: () =>
						sql`SELECT position,notice FROM cloudflare_workspace_outbox ORDER BY position LIMIT 64`,
				})(undefined)
			})
		}
		return {
			handler,
			bind,
			transfers,
			collect,
			acknowledge: (position: number) =>
				sql`DELETE FROM cloudflare_workspace_outbox WHERE position<=${position}`,
		}
	})
}
class WorkspaceObject extends Context.Service<
	WorkspaceObject,
	Effect.Success<ReturnType<typeof makeWorkspaceObject>>
>()("CloudflareWorkspaceObject") {}

export class AlkalyeWorkspace extends DurableObject<DeploymentEnvironment> {
	private runtime
	private ready

	constructor(context: DurableObjectState, environment: DeploymentEnvironment) {
		super(context, environment)
		this.runtime = ManagedRuntime.make(
			workspaceLayer(context.storage, environment),
		)
		this.ready = context.blockConcurrencyWhile(() =>
			this.runtime.runPromise(WorkspaceObject),
		)
	}

	async handle(
		workspace: string,
		identity: typeof Identity.Service,
		request: Request,
	) {
		let object = await this.ready
		let principal = await this.runtime.runPromise(
			Schema.decodeUnknownEffect(delegatedIdentity)(identity),
		)
		let bound = await this.runtime.runPromise(object.bind(workspace))
		if (bound._tag === "None")
			return new Response("Workspace binding mismatch", { status: 409 })
		let response = await object.handler(
			request,
			Context.make(Identity, principal),
		)
		await this.deliverNotices()
		return response
	}

	async alarm() {
		await this.deliverNotices()
	}

	async importWorkspace(
		workspace: string,
		generation: number,
		request: Request,
	) {
		if (
			request.method !== "POST" ||
			request.headers.get("Content-Type") !== "application/octet-stream"
		)
			return new Response("Invalid transfer request", { status: 400 })

		let object = await this.ready

		let bundle = await this.runtime.runPromise(
			Schema.decodeUnknownEffect(WorkspaceTransferCodec)(
				new Uint8Array(await request.arrayBuffer()),
			),
		)

		if (bundle.workspace !== workspace || bundle.generation !== generation)
			return new Response("Transfer identity mismatch", { status: 409 })
		let bound = await this.runtime.runPromise(object.bind(bundle.workspace))
		if (bound._tag === "None") throw new Error("Workspace binding mismatch")

		await this.runtime.runPromise(object.transfers.importWorkspace(bundle))

		await this.runtime.runPromise(
			object.transfers.activateImportedWorkspace(
				bundle.workspace,
				bundle.generation,
			),
		)

		return new Response(null, { status: 204 })
	}

	private async deliverNotices() {
		let object = await this.ready
		let messages = await this.runtime.runPromise(object.collect())
		if (!messages.length) return
		try {
			let relay = this.env.RELAY.get(this.env.RELAY.idFromName("primary"))
			await relay.notify(messages.map(message => message.notice))
			let last = messages.at(-1)
			if (last) await this.runtime.runPromise(object.acknowledge(last.position))
			if (messages.length === 64)
				await this.ctx.storage.setAlarm(Date.now() + 1)
		} catch {
			await this.ctx.storage.setAlarm(Date.now() + 5000)
		}
	}

	fetch() {
		return new Response("Workspace access requires the authenticated gateway", {
			status: 403,
		})
	}
}
