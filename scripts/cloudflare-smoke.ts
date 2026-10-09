import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../src/platform/signatures"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { encode } from "../src/shared/base64"
import { DocumentApi } from "../src/shared/document-api"
import { buildAction, restoreSnapshot } from "../src/shared/document-actions"
import { blobDigest } from "../src/shared/document-blobs"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"

let root = resolve(import.meta.dir, "..")
let directory = await mkdtemp(join(tmpdir(), "alkalye-cloudflare-smoke-"))
let origin = "http://127.0.0.1:8791"
let configurationSchema = Schema.StructWithRest(
	Schema.Struct({
		main: Schema.String,
		assets: Schema.StructWithRest(Schema.Struct({ directory: Schema.String }), [
			Schema.Record(Schema.String, Schema.Unknown),
		]),
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
)
let configuration = Schema.decodeUnknownSync(configurationSchema)(
	Bun.JSONC.parse(await Bun.file(join(root, "wrangler.jsonc")).text()),
)
let localConfiguration = {
	...configuration,
	main: join(root, configuration.main),
	assets: {
		...configuration.assets,
		directory: join(root, configuration.assets.directory),
	},
}
let config = join(directory, "wrangler.json")
await Bun.write(config, JSON.stringify(localConfiguration))
await Bun.write(
	join(directory, ".dev.vars"),
	"ALKALYE_MASTER_KEY=" +
		encode(crypto.getRandomValues(new Uint8Array(32))) +
		"\n",
)
let child: ReturnType<typeof Bun.spawn> | undefined
let runs = 0
function ensure(value: boolean, message: string) {
	if (!value) throw Error(message)
}
async function start() {
	runs++
	let log = Bun.file(join(directory, `worker-${runs}.log`))
	child = Bun.spawn(
		[
			"bun",
			"x",
			"--no-install",
			"wrangler",
			"dev",
			"--config",
			config,
			"--local",
			"--ip",
			"127.0.0.1",
			"--port",
			"8791",
			"--inspector-port",
			"0",
			"--persist-to",
			join(directory, "state"),
		],
		{ cwd: root, stdout: log, stderr: log },
	)
	let deadline = Date.now() + 30000
	while (true) {
		let response = await fetch(origin + "/api/health", {
			signal: AbortSignal.timeout(1000),
		}).catch(() => undefined)
		if (response?.ok) break
		if (child.exitCode !== null || Date.now() >= deadline)
			throw Error(
				`Local Worker readiness unavailable; retained log ${log.name}`,
			)
	}
}
async function stop() {
	if (!child) return
	child.kill("SIGTERM")
	await child.exited
	child = undefined
}
async function exercise() {
	return Effect.runPromise(
		Effect.gen(function* () {
			let signatures = yield* Signatures
			let identity = yield* signatures.account(
				Redacted.make(encode(crypto.getRandomValues(new Uint8Array(32)))),
			)
			let anonymous = yield* HttpApiClient.make(DocumentApi, {
				baseUrl: origin,
			})
			let challenge = yield* anonymous.authentication.challenge({
				payload: { publicKey: identity.publicKey, purpose: "bearer" },
			})
			let signature = yield* identity.signAuthentication(challenge, {
				origin,
				purpose: "bearer",
			})
			let login = yield* anonymous.authentication.bearerLogin({
				payload: { id: challenge.id, publicKey: identity.publicKey, signature },
			})
			let api = yield* HttpApiClient.make(DocumentApi, {
				baseUrl: origin,
				transformClient: client =>
					HttpClient.mapRequest(
						client,
						HttpClientRequest.bearerToken(Redacted.make(login.token)),
					),
			})
			let document = crypto.randomUUID()
			let content = "Cloudflare durable source 😀\nSecond line"
			let action = yield* buildAction(
				new Replica(identity.subject + "-birth"),
				document,
				"Create",
				replica => newDocument(replica, document, "Untitled", content),
			)
			let position = yield* api.documents.create({
				payload: { workspace: "personal-" + identity.subject, action },
			})
			let snapshot = yield* api.documents.snapshot({
				params: { document },
				query: { encoding: "compact" },
			})
			ensure(snapshot.position === position, "Created position differs")
			let replica = yield* restoreSnapshot(snapshot, identity.subject + "-read")
			ensure(replica.text(document) === content, "Real Worker source differs")
			let rejected = yield* anonymous.documents
				.snapshot({ params: { document }, query: {} })
				.pipe(Effect.result)
			ensure(
				rejected._tag === "Failure" &&
					rejected.failure._tag === "AuthenticationRequired",
				"Anonymous access was not rejected by authentication",
			)
			let bytes = new Uint8Array([0, 255, 128, 60, 62, 10, 0])
			let digest = yield* blobDigest(bytes)
			yield* api.documents.putBlob({
				params: { document, digest },
				payload: bytes,
			})
			let stored = yield* api.documents.getBlob({
				params: { document, digest },
			})
			ensure(
				stored.length === bytes.length &&
					stored.every((value, index) => value === bytes[index]),
				"R2 blob differs",
			)
			return { document, content, token: login.token, position, digest, bytes }
		}).pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.provide(Signatures.layer),
			Effect.provide(webCryptoLayer),
			Effect.timeout("60 seconds"),
		),
	)
}
try {
	await start()
	let home = await fetch(origin + "/app.html")
	ensure(
		home.ok && (await home.text()).includes("app.js"),
		"Static app missing",
	)
	let state = await exercise()
	let route = origin + "/app/doc/" + state.document
	let page = await fetch(route, { redirect: "manual" })
	ensure(
		page.status === 200 &&
			page.headers.get("location") === null &&
			page.url === route &&
			(await page.text()).includes("app.js"),
		"Document route redirected or lost its original URL",
	)
	await stop()
	await start()
	await Effect.runPromise(
		Effect.gen(function* () {
			let api = yield* HttpApiClient.make(DocumentApi, {
				baseUrl: origin,
				transformClient: client =>
					HttpClient.mapRequest(
						client,
						HttpClientRequest.bearerToken(Redacted.make(state.token)),
					),
			})
			let snapshot = yield* api.documents.snapshot({
				params: { document: state.document },
				query: { encoding: "compact" },
			})
			ensure(snapshot.position === state.position, "Restart position changed")
			let replica = yield* restoreSnapshot(snapshot, "smoke-reopened")
			ensure(
				replica.text(state.document) === state.content,
				"Restart lost durable source",
			)
			let bytes = yield* api.documents.getBlob({
				params: { document: state.document, digest: state.digest },
			})
			ensure(
				bytes.length === state.bytes.length &&
					bytes.every((value, index) => value === state.bytes[index]),
				"Restart lost R2 blob",
			)
		}).pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.timeout("60 seconds"),
		),
	)
	console.log(
		"PASS local workerd: health, static app, signed auth, durable creation, access denial, R2 blob, cold restart/readback",
	)
	await stop()
	await rm(directory, { recursive: true, force: true })
} catch (error) {
	console.error(
		"Local Worker smoke failed; private logs/state retained at",
		directory,
	)
	throw error
} finally {
	await stop()
}
