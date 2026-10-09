import { Database } from "bun:sqlite"
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
let remoteIndex = Bun.argv.indexOf("--origin")
let remote = remoteIndex >= 0
let remoteOrigin = remote ? Bun.argv[remoteIndex + 1] : undefined
if (remote && !remoteOrigin) throw Error("Provide a remote HTTPS origin")
let origin = remoteOrigin ?? "http://127.0.0.1:8791"
if (
	remote &&
	(new URL(origin).protocol !== "https:" || new URL(origin).origin !== origin)
)
	throw Error("Remote smoke requires an HTTPS origin without a path")
let config = join(directory, "wrangler.json")
if (!remote) {
	let configurationSchema = Schema.StructWithRest(
		Schema.Struct({
			main: Schema.String,
			assets: Schema.StructWithRest(
				Schema.Struct({ directory: Schema.String }),
				[Schema.Record(Schema.String, Schema.Unknown)],
			),
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
	await Bun.write(config, JSON.stringify(localConfiguration))
	await Bun.write(
		join(directory, ".dev.vars"),
		"ALKALYE_MASTER_KEY=" +
			encode(crypto.getRandomValues(new Uint8Array(32))) +
			"\n",
	)
}
let child: ReturnType<typeof Bun.spawn> | undefined
let runs = 0
function ensure(value: boolean, message: string) {
	if (!value) throw Error(message)
}
async function start() {
	runs++
	let log = Bun.file(join(directory, `worker-${runs}.log`))
	if (!remote)
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
		if ((child && child.exitCode !== null) || Date.now() >= deadline)
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
async function verifyLocalR2(state: {
	document: string
	digest: string
	bytes: Uint8Array
}) {
	let objectKey: string | undefined
	let objectReceipt: string | undefined
	for await (let path of new Bun.Glob("**/*.sqlite").scan({
		cwd: join(directory, "state"),
		absolute: true,
	})) {
		let database = new Database(path, { readonly: true })
		try {
			let table = database
				.query("SELECT name FROM sqlite_master WHERE name='document_blobs'")
				.get()
			if (!table) continue
			let row = database
				.query(
					"SELECT external,length(bytes) AS retainedBytes,object_key,object_receipt FROM document_blobs WHERE document=? AND digest=?",
				)
				.get(state.document, state.digest)
			if (!row) continue
			let receipt = Schema.decodeUnknownSync(
				Schema.Struct({
					external: Schema.Literal(1),
					retainedBytes: Schema.Literal(0),
					object_key: Schema.String,
					object_receipt: Schema.String,
				}),
			)(row)
			ensure(objectKey === undefined, "Multiple persisted attachment receipts")
			objectKey = receipt.object_key
			objectReceipt = receipt.object_receipt
		} finally {
			database.close()
		}
	}
	ensure(objectKey !== undefined, "Attachment is not stored externally in R2")
	if (!objectKey || !objectReceipt) throw Error("R2 object receipt unavailable")
	ensure(
		objectKey ===
			`documents/${encodeURIComponent(state.document)}/chunks/${state.digest}`,
		"R2 object key is not deterministic",
	)
	let output = join(directory, "r2.private.bin")
	let log = Bun.file(join(directory, "r2-readback.log"))
	let readback = Bun.spawn(
		[
			"bun",
			"x",
			"--no-install",
			"wrangler",
			"r2",
			"object",
			"get",
			"alkalye-effect-rewrite-assets/" + objectKey,
			"--local",
			"--config",
			config,
			"--persist-to",
			join(directory, "state"),
			"--file",
			output,
		],
		{ cwd: root, stdout: log, stderr: log },
	)
	if ((await readback.exited) !== 0)
		throw Error("Direct local R2 readback failed")
	let bytes = new Uint8Array(await Bun.file(output).arrayBuffer())
	ensure(
		bytes.length === state.bytes.length &&
			bytes.every((value, index) => value === state.bytes[index]),
		"Direct R2 bytes differ",
	)
	return { key: objectKey, receipt: objectReceipt }
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
			yield* api.workspaces.create({
				payload: {
					workspace: "personal-" + identity.subject,
					name: "Personal",
					request: "personal-v1",
				},
			})
			let document = crypto.randomUUID()
			let content = "Cloudflare durable source 😀\nSecond line"
			let action = yield* buildAction(
				new Replica(identity.subject + "-birth"),
				document,
				"Create",
				replica => newDocument(replica, document, "Untitled", content),
			)
			yield* Effect.promise(() =>
				Bun.write(
					join(directory, "fixture.private.json"),
					JSON.stringify({
						document,
						content,
						subject: identity.subject,
						token: login.token,
						stage: "before-create",
					}),
				),
			)
			let position = yield* api.documents.create({
				payload: { workspace: "personal-" + identity.subject, action },
			})
			yield* Effect.promise(() =>
				Bun.write(
					join(directory, "fixture.private.json"),
					JSON.stringify({
						document,
						content,
						subject: identity.subject,
						token: login.token,
						position,
						stage: "created",
					}),
				),
			)
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
				"durable blob differs",
			)
			return {
				document,
				content,
				token: login.token,
				subject: identity.subject,
				position,
				digest,
				bytes,
			}
		}).pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.provide(Signatures.layer),
			Effect.provide(webCryptoLayer),
			Effect.timeout("60 seconds"),
		),
	)
}
async function readback(
	state: Awaited<ReturnType<typeof exercise>>,
	upload = false,
) {
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
			if (upload)
				yield* api.documents.putBlob({
					params: { document: state.document, digest: state.digest },
					payload: state.bytes,
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
				"Restart lost durable blob",
			)
		}).pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.timeout("60 seconds"),
		),
	)
}

async function mcpRequest(
	token: string,
	name: string,
	args: Record<string, unknown>,
) {
	return fetch(origin + "/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			Authorization: "Bearer " + token,
			"MCP-Protocol-Version": "2026-07-28",
			"Mcp-Method": "tools/call",
			"Mcp-Name": name,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name,
				arguments: args,
				_meta: {
					"io.modelcontextprotocol/protocolVersion": "2026-07-28",
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		}),
		signal: AbortSignal.timeout(15000),
	})
}
async function mcpResult(
	token: string,
	name: string,
	args: Record<string, unknown>,
) {
	let response = await mcpRequest(token, name, args)
	ensure(response.status === 200, "MCP tool request failed")
	let envelope = Schema.decodeUnknownSync(
		Schema.Struct({
			result: Schema.Struct({
				isError: Schema.optionalKey(Schema.Boolean),
				structuredContent: Schema.Unknown,
			}),
		}),
	)(await response.json())
	ensure(envelope.result.isError !== true, "MCP tool returned an error")
	return envelope.result.structuredContent
}
async function verifyAgentCapabilities(
	state: Awaited<ReturnType<typeof exercise>>,
) {
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
			let name = "Worker smoke reader"
			yield* Effect.promise(() =>
				Bun.write(
					join(directory, "agent.private.json"),
					JSON.stringify({ name, stage: "before-create" }),
				),
			)
			let key = yield* api.agents.create({
				payload: {
					name,
					workspaces: ["personal-" + state.subject],
					ceiling: "reader",
				},
			})
			yield* Effect.promise(() =>
				Bun.write(
					join(directory, "agent.private.json"),
					JSON.stringify({ name, token: key.token, stage: "created" }),
				),
			)
			let connection = (yield* api.agents.list()).find(
				entry => entry.name === name,
			)
			if (!connection) throw Error("Reader connection receipt missing")
			yield* Effect.promise(() =>
				Bun.write(
					join(directory, "agent.private.json"),
					JSON.stringify({
						name,
						token: key.token,
						id: connection.id,
						stage: "created",
					}),
				),
			)
			let record = yield* Effect.promise(async () =>
				Schema.decodeUnknownSync(
					Schema.Struct({
						documentId: Schema.String,
						content: Schema.String,
						revision: Schema.String,
					}),
				)(
					await mcpResult(key.token, "get_document", {
						documentId: state.document,
					}),
				),
			)
			ensure(
				record.documentId === state.document &&
					record.content === state.content,
				"MCP exact source differs",
			)
			let listing = yield* Effect.promise(async () =>
				Schema.decodeUnknownSync(
					Schema.Struct({
						personal: Schema.Array(
							Schema.Struct({ documentId: Schema.String }),
						),
						spaces: Schema.Array(
							Schema.Struct({
								documents: Schema.Array(
									Schema.Struct({ documentId: Schema.String }),
								),
							}),
						),
					}),
				)(await mcpResult(key.token, "list_documents", {})),
			)
			ensure(
				[
					...listing.personal,
					...listing.spaces.flatMap(space => space.documents),
				].some(document => document.documentId === state.document),
				"MCP reader listing missing document",
			)
			let denied = yield* Effect.promise(() =>
				mcpRequest(key.token, "update_document", {
					documentId: state.document,
					content: "Reader must not write",
					expectedRevision: record.revision,
				}),
			)
			let denial = Schema.decodeUnknownSync(
				Schema.Struct({
					result: Schema.Struct({ isError: Schema.Literal(true) }),
				}),
			)(yield* Effect.promise(() => denied.json()))
			ensure(denial.result.isError, "Reader grant permitted a write")
			let child = yield* Effect.acquireRelease(
				Effect.sync(() =>
					Bun.spawn(
						[
							"bun",
							"cli.ts",
							"--server",
							origin,
							"--home",
							join(directory, "cli-home"),
							"doc",
							"content",
							state.document,
						],
						{
							cwd: root,
							env: {
								...process.env,
								ALKALYE_API_KEY: key.token,
								ALKALYE_MCP_TOKEN: "",
							},
							stdin: "ignore",
							stdout: "pipe",
							stderr: "pipe",
						},
					),
				),
				child =>
					Effect.promise(async () => {
						if (child.exitCode === null) child.kill("SIGTERM")
						await child.exited
					}),
			)
			let [output, error, status] = yield* Effect.promise(() =>
				Promise.all([
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
					child.exited,
				]),
			)
			yield* Effect.promise(() =>
				Bun.write(join(directory, "cli.private.stderr"), error),
			)
			ensure(
				status === 0 && output === state.content + "\n",
				"CLI scoped-key exact source differs",
			)
			yield* Effect.promise(() =>
				Bun.write(
					join(directory, "agent.private.json"),
					JSON.stringify({
						name,
						token: key.token,
						id: connection.id,
						stage: "before-revoke",
					}),
				),
			)
			yield* api.agents.revoke({ params: { id: connection.id } })
			let revoked = yield* Effect.promise(() =>
				mcpRequest(key.token, "get_document", { documentId: state.document }),
			)
			ensure(revoked.status === 401, "Revoked API key still accesses MCP")
		}).pipe(
			Effect.scoped,
			Effect.provide(FetchHttpClient.layer),
			Effect.timeout("60 seconds"),
		),
	)
	await readback(state)
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
	let firstR2: Awaited<ReturnType<typeof verifyLocalR2>> | undefined
	if (!remote) {
		await stop()
		firstR2 = await verifyLocalR2(state)
		await start()
	}
	await readback(state, true)
	if (!remote) {
		await stop()
		let secondR2 = await verifyLocalR2(state)
		ensure(
			firstR2 !== undefined &&
				firstR2.key === secondR2.key &&
				firstR2.receipt !== secondR2.receipt,
			"Repeated upload did not reuse physical key with a fresh receipt",
		)
		let receiptProof = directory + ".receipts.private.json"
		await Bun.write(
			receiptProof,
			JSON.stringify({ first: firstR2, second: secondR2 }),
		)
		console.log("Local R2 receipt-only proof retained at", receiptProof)
		await start()
		await readback(state)
	}
	await verifyAgentCapabilities(state)
	console.log(
		remote
			? "PASS deployed Worker: health, static app, signed auth, durable creation, access denial, durable blob, independent readback, scoped API-key MCP/CLI/revocation"
			: "PASS local workerd: health, static app, signed auth, durable creation, access denial, physical R2 bytes/key reuse/new receipts, cold restart/readback, scoped API-key MCP/CLI/revocation",
	)
	await stop()
	await rm(directory, { recursive: true, force: true })
} catch (error) {
	console.error(
		"Worker smoke failed; private fixture/logs retained at",
		directory,
	)
	throw error
} finally {
	await stop()
}
