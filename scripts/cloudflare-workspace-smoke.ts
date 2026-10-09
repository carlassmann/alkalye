import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Database } from "bun:sqlite"
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
import { cookieLogin, livePoll, liveSocket } from "../tests/live-fixture"
import type {
	LiveLogin,
	LiveMessage,
	LivePeerFixture,
} from "../tests/live-fixture"
import { object } from "../src/shared/model"
import type * as Crypto from "effect/Crypto"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"
import { invitationDigest } from "../src/shared/invitations"

let root = resolve(import.meta.dir, "..")
let directory = await mkdtemp(join(tmpdir(), "alkalye-cloudflare-workspaces-"))
let probeOnly = Bun.argv[2] === "--rpc-probe"
let requestedOrigin = Bun.argv[2] === "--origin" ? Bun.argv[3] : undefined
if (
	!probeOnly &&
	Bun.argv.length > 2 &&
	(!requestedOrigin || Bun.argv.length !== 4)
)
	throw Error(
		"Usage: bun scripts/cloudflare-live-smoke.ts [--origin https://host]",
	)
let remote = requestedOrigin !== undefined
let origin = requestedOrigin
	? new URL(requestedOrigin).origin
	: "http://127.0.0.1:18803"
if (remote && !origin.startsWith("https://"))
	throw Error("Remote mode requires HTTPS")
let config = join(directory, "wrangler.json")
let gateway = join(directory, "workspace-gateway.ts")
await Bun.write(
	gateway,
	(
		await Bun.file(
			join(root, "tests/cloudflare-workspace-gateway.ts.txt"),
		).text()
	).replaceAll("../src/", root + "/src/"),
)
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
		main: gateway,
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
	if (remote) {
		let response = await fetch(origin + "/api/health", {
			signal: AbortSignal.timeout(30000),
		})
		ensure(response.ok, "Remote health unavailable")
		return
	}
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
			"18803",
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
type Client = Effect.Success<ReturnType<typeof client>>
function run<A, E>(
	effect: Effect.Effect<
		A,
		E,
		Signatures | HttpClient.HttpClient | Crypto.Crypto
	>,
) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provide(Signatures.layer),
			Effect.provide(FetchHttpClient.layer),
			Effect.provide(webCryptoLayer),
			Effect.timeout("30 seconds"),
		),
	)
}
function client(seed: number) {
	return Effect.gen(function* () {
		let signatures = yield* Signatures
		let identity = yield* signatures.account(
			Redacted.make(encode(new Uint8Array(32).fill(seed))),
		)
		let anonymous = yield* HttpApiClient.make(DocumentApi, { baseUrl: origin })
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
		return { api, subject: login.subject, token: login.token }
	})
}
function snapshot(account: Client, document: string) {
	return account.api.documents.snapshot({
		params: { document },
		query: { encoding: "compact" },
	})
}
function insert(account: Client, document: string, text: string) {
	return Effect.gen(function* () {
		let state = yield* restoreSnapshot(
			yield* snapshot(account, document),
			account.subject + "-" + crypto.randomUUID(),
		)
		return yield* buildAction(state, document, "Insert", staged => [
			staged.edit(document, staged.text(document) + text),
		])
	})
}
function cursor(document: string, position: number) {
	return {
		actor: "ignored",
		name: "ignored",
		document,
		cursor: position,
		slide: 0,
		x: 10,
		y: 20,
		time: 0,
		presenting: true,
	}
}
if (remote) throw Error("Workspace isolation smoke is local-only")
let phase = "startup"
let socket: LivePeerFixture | undefined
let polling: ReturnType<typeof livePoll> | undefined
try {
	await start()
	if (probeOnly) {
		let response = await fetch(origin + "/__test/workspace-rpc", {
			method: "POST",
			signal: AbortSignal.timeout(30000),
		})
		await Bun.write(join(directory, "rpc-probe.json"), await response.text())
		await stop()
		console.log("Private RPC probe retained", directory)
		process.exit(response.ok ? 0 : 1)
	}
	phase = "authenticated-clients"
	let [owner, writer, reader] = await Promise.all([
		run(client(201)),
		run(client(202)),
		run(client(203)),
	])
	let workspace = crypto.randomUUID(),
		document = crypto.randomUUID(),
		otherWorkspace = crypto.randomUUID(),
		otherDocument = crypto.randomUUID()
	await Bun.write(
		join(directory, "fixture.private.json"),
		JSON.stringify({
			workspace,
			document,
			otherWorkspace,
			otherDocument,
			stage: "allocated-before-first-mutation",
		}),
	)
	await run(
		owner.api.workspaces.create({
			payload: {
				workspace,
				name: "Cloudflare live proof",
				request: crypto.randomUUID(),
			},
		}),
	)
	await run(
		owner.api.workspaces.membership({
			params: { workspace, member: writer.subject },
			payload: { role: "writer", request: crypto.randomUUID() },
		}),
	)
	let invitation = crypto.randomUUID(),
		secret = encode(crypto.getRandomValues(new Uint8Array(32)))
	await run(
		owner.api.invitations.create({
			payload: {
				invitation,
				target: { workspace },
				role: "reader",
				digest: await run(invitationDigest(secret)),
			},
		}),
	)
	await run(
		reader.api.invitations.accept({
			params: { invitation },
			payload: { secret, request: crypto.randomUUID() },
		}),
	)
	phase = "durable-document-create"
	let source = "Shared Cloudflare source 😀"
	let birth = await run(
		buildAction(
			new Replica(owner.subject + "-" + crypto.randomUUID()),
			document,
			"Create",
			staged => newDocument(staged, document, "Untitled", source),
		),
	)
	await run(
		owner.api.documents.create({ payload: { workspace, action: birth } }),
	)
	phase = "second-workspace-isolation"
	await run(
		owner.api.workspaces.create({
			payload: {
				workspace: otherWorkspace,
				name: "Independent Cloudflare workspace",
				request: crypto.randomUUID(),
			},
		}),
	)
	let otherSource = "Isolated second workspace Ω"
	let otherBirth = await run(
		buildAction(
			new Replica(owner.subject + "-" + crypto.randomUUID()),
			otherDocument,
			"Create",
			staged => newDocument(staged, otherDocument, "Untitled", otherSource),
		),
	)
	await run(
		owner.api.documents.create({
			payload: { workspace: otherWorkspace, action: otherBirth },
		}),
	)
	let outside = await run(snapshot(reader, otherDocument).pipe(Effect.result))
	ensure(outside._tag === "Failure", "Workspace A reader accessed workspace B")
	let forged = await fetch(
		origin + "/api/documents/" + otherDocument + "/snapshot?encoding=compact",
		{
			headers: {
				Authorization: "Bearer " + reader.token,
				"x-identity": owner.subject,
				"x-alkalye-subject": owner.subject,
			},
			signal: AbortSignal.timeout(10000),
		},
	)
	ensure(
		forged.status === 401 || forged.status === 403 || forged.status === 404,
		"Client identity headers granted access",
	)
	let direct = await fetch(
		origin +
			"/__test/workspace-direct?workspace=" +
			encodeURIComponent(workspace),
	)
	ensure(direct.status === 403, "Direct workspace stub fetch admitted access")
	phase = "mcp-workspace-scope"
	let limited = await run(
		owner.api.agents.create({
			payload: {
				name: "Workspace isolation reader",
				workspaces: [workspace],
				ceiling: "reader",
			},
		}),
	)
	for (let [target, allowed] of [
		[document, true],
		[otherDocument, false],
	] satisfies [string, boolean][]) {
		let response = await fetch(origin + "/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				Authorization: "Bearer " + limited.token,
				"MCP-Protocol-Version": "2026-07-28",
				"Mcp-Method": "tools/call",
				"Mcp-Name": "get_document",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "get_document",
					arguments: { documentId: target },
					_meta: {
						"io.modelcontextprotocol/protocolVersion": "2026-07-28",
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
			signal: AbortSignal.timeout(15000),
		})
		let envelope = Schema.decodeUnknownSync(
			Schema.Struct({
				result: Schema.optionalKey(
					Schema.Struct({
						isError: Schema.optionalKey(Schema.Boolean),
						structuredContent: Schema.optionalKey(Schema.Unknown),
					}),
				),
				error: Schema.optionalKey(Schema.Unknown),
			}),
		)(await response.json())
		ensure(
			allowed
				? response.ok &&
						envelope.result !== undefined &&
						envelope.result.isError !== true
				: !response.ok ||
						envelope.error !== undefined ||
						envelope.result?.isError === true,
			"MCP workspace attenuation differs",
		)
		if (allowed) {
			let record = Schema.decodeUnknownSync(
				Schema.Struct({ content: Schema.String, revision: Schema.String }),
			)(envelope.result?.structuredContent)
			ensure(record.content === source, "MCP scoped document source differs")
		}
	}
	phase = "real-websocket-and-poll-open"
	let readerLogin = await cookieLogin(new URL(origin), 203)
	polling = livePoll(readerLogin)
	await polling.open()
	let readerActor = (
		await polling.until(message => message.type === "connected")
	).actor
	socket = await liveSocket(await cookieLogin(new URL(origin), 201))
	let ownerActor = (await socket.until(message => message.type === "connected"))
		.actor
	ensure(ownerActor !== readerActor, "Peer actors must be unique")
	ensure(
		(await polling.send([{ type: "watch", document }])) === 204,
		"Reader watch failed",
	)
	ensure(
		(await polling.send([{ type: "watch", document: otherDocument }])) === 204,
		"Unauthorized watch protocol status differs",
	)
	await polling.until(
		message =>
			message.type === "unavailable" && message.document === otherDocument,
	)
	socket.send({ type: "watch", document })
	socket.send({ type: "presence", presence: cursor(document, 3) })
	let ownerPresence = object(
		(await polling.until(message => message.type === "presence")).presence,
	)
	ensure(
		ownerPresence.actor === ownerActor &&
			ownerPresence.cursor === 3 &&
			ownerPresence.own === false,
		"Cross-transport writer presence differs",
	)
	ensure(
		(await polling.send([
			{ type: "presence", presence: cursor(document, 7) },
		])) === 204,
		"Reader presence send failed",
	)
	let readerPresence = object(
		(await socket.until(message => message.type === "presence")).presence,
	)
	ensure(
		readerPresence.actor === readerActor &&
			readerPresence.cursor === 7 &&
			readerPresence.x === -1 &&
			readerPresence.presenting === false,
		"Reader presentation capability leaked",
	)
	phase = "concurrent-durable-edits"
	let [first, second] = await Promise.all([
		run(insert(owner, document, " OWNER")),
		run(insert(writer, document, " WRITER")),
	])
	let accepted = await Promise.all([
		run(owner.api.documents.commit({ params: { document }, payload: first })),
		run(writer.api.documents.commit({ params: { document }, payload: second })),
	])
	ensure(
		accepted[0] !== accepted[1],
		"Concurrent accepted positions must differ",
	)
	let result = await run(snapshot(owner, document))
	let canonical = await run(restoreSnapshot(result, crypto.randomUUID()))
	let text = canonical.text(document)
	ensure(
		text.includes(" OWNER") &&
			text.includes(" WRITER") &&
			text.startsWith(source),
		"Concurrent edits did not converge",
	)
	await polling.until(message => message.type === "advanced")
	await socket.until(message => message.type === "advanced")
	phase = "reader-write-refused"
	let denied = await run(
		reader.api.documents
			.commit({
				params: { document },
				payload: await run(insert(reader, document, " FORBIDDEN")),
			})
			.pipe(Effect.result),
	)
	ensure(denied._tag === "Failure", "Reader mutation accepted")
	ensure(
		(
			await run(
				restoreSnapshot(
					await run(snapshot(owner, document)),
					crypto.randomUUID(),
				),
			)
		).text(document) === text,
		"Reader denial changed source",
	)
	let separate = await run(
		restoreSnapshot(
			await run(snapshot(owner, otherDocument)),
			crypto.randomUUID(),
		),
	)
	ensure(
		separate.text(otherDocument) === otherSource,
		"Workspace A edits changed workspace B",
	)
	phase = "poll-reconnect"
	ensure((await polling.close()) === 204, "Poll close failed")
	ensure((await polling.poll()) === 410, "Closed poll session resumed")
	await polling.open()
	await polling.until(message => message.type === "connected")
	ensure(
		(await polling.send([{ type: "watch", document }])) === 204,
		"Fresh poll watch failed",
	)
	phase = "socket-peer-cleanup"
	socket.send({ type: "presence", presence: cursor(document, 11) })
	await polling.until(message => message.type === "presence")
	socket.close()
	let gone = await polling.until(message => message.type === "gone")
	ensure(
		gone.actor === ownerActor && gone.document === document,
		"Socket close did not remove presence",
	)
	socket = undefined
	await run(
		owner.api.workspaces.membership({
			params: { workspace: otherWorkspace, member: reader.subject },
			payload: { role: "reader", request: crypto.randomUUID() },
		}),
	)
	ensure(
		(await polling.send([{ type: "watch", document: otherDocument }])) === 204,
		"Second authorized workspace watch failed",
	)
	phase = "revocation"
	await run(owner.api.invitations.revoke({ params: { invitation } }))
	await polling.until(
		message => message.type === "unavailable" && message.document === document,
	)
	let stillAllowed = await run(
		restoreSnapshot(
			await run(snapshot(reader, otherDocument)),
			crypto.randomUUID(),
		),
	)
	ensure(
		stillAllowed.text(otherDocument) === otherSource,
		"Revocation in A revoked B access",
	)
	let revoked = await run(snapshot(reader, document).pipe(Effect.result))
	ensure(revoked._tag === "Failure", "Revoked reader retained snapshot access")
	ensure(
		(await polling.send([
			{ type: "presence", presence: cursor(document, 12) },
		])) === 204,
		"Revoked peer protocol response differs",
	)
	ensure((await polling.close()) === 204, "Final poll cleanup failed")
	polling = undefined
	if (!remote) {
		phase = "cold-object-restart-and-resume"
		let ownerLogin = await cookieLogin(new URL(origin), 201)
		polling = livePoll(ownerLogin)
		await polling.open()
		await polling.until(message => message.type === "connected")
		await stop()
		await start()
		ensure(
			(await polling.poll()) === 410,
			"Old in-memory poll survived a cold object restart",
		)
		await polling.open()
		await polling.until(message => message.type === "connected")
		socket = await liveSocket(ownerLogin)
		await socket.until(message => message.type === "connected")
		socket.send({ type: "watch", document })
		let reopened = await run(
			restoreSnapshot(
				await run(snapshot(owner, document)),
				crypto.randomUUID(),
			),
		)
		ensure(
			reopened.text(document) === text,
			"Cold object restart changed durable source",
		)
		socket.close()
		socket = undefined
		await polling.close()
		polling = undefined
	}

	phase = "closed-native-sqlite-partitions"
	await stop()
	let partitions: {
		workspace: string | null
		first: number
		second: number
	}[] = []
	for await (let path of new Bun.Glob("**/*.sqlite").scan({
		cwd: join(directory, "state"),
		absolute: true,
	})) {
		let database = new Database(path, { readonly: true })
		try {
			let tables = database
				.query<{ name: string }, []>(
					"SELECT name FROM sqlite_master WHERE type='table'",
				)
				.all()
				.map(row => row.name)
			let binding = tables.includes("cloudflare_workspace_identity")
				? (database
						.query<{ workspace: string }, []>(
							"SELECT workspace FROM cloudflare_workspace_identity",
						)
						.get()?.workspace ?? null)
				: null
			let first = tables.includes("document_heads")
				? (database
						.query<{ count: number }, [string]>(
							"SELECT COUNT(*) count FROM document_heads WHERE document=?",
						)
						.get(document)?.count ?? 0)
				: 0
			let second = tables.includes("document_heads")
				? (database
						.query<{ count: number }, [string]>(
							"SELECT COUNT(*) count FROM document_heads WHERE document=?",
						)
						.get(otherDocument)?.count ?? 0)
				: 0
			partitions.push({ workspace: binding, first, second })
		} finally {
			database.close()
		}
	}
	ensure(
		partitions.filter(
			row => row.workspace === workspace && row.first === 1 && row.second === 0,
		).length === 1,
		"Workspace A database isolation differs",
	)
	ensure(
		partitions.filter(
			row =>
				row.workspace === otherWorkspace && row.first === 0 && row.second === 1,
		).length === 1,
		"Workspace B database isolation differs",
	)
	ensure(
		partitions
			.filter(row => row.workspace === null)
			.every(row => row.first === 0 && row.second === 0),
		"Primary database retained new document bodies",
	)
	await Bun.write(
		join(directory, "result.json"),
		JSON.stringify({
			passed: true,
			phases: [
				"two-workspaces-isolated-native-sqlite",
				"invitation-acceptance-and-revocation",
				"scoped-key-and-mcp-attenuation",
				"untrusted-identity-headers-denied",
				"direct-stub-fetch-denied",
				"cross-workspace-revocation-isolated",
				"cookie-auth",
				"websocket",
				"poll",
				"presence",
				"reader-capabilities",
				"concurrent-writers",
				"reader-denial",
				"poll-reconnect",
				"peer-cleanup",
				"revocation",
				...(remote ? [] : ["cold-object-restart-and-resume"]),
			],
			runtime: remote
				? "remote HTTPS AlkalyeRelay"
				: "local workerd actual AlkalyeRelay",
			sourceSHA: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
			otherSourceSHA: new Bun.CryptoHasher("sha256")
				.update(otherSource)
				.digest("hex"),
			storage: {
				workspaceDatabases: partitions.filter(row => row.workspace !== null)
					.length,
				primaryDocumentBodies: partitions
					.filter(row => row.workspace === null)
					.reduce((sum, row) => sum + row.first + row.second, 0),
			},
		}),
	)
	console.log(
		"PASS real Cloudflare live: WS/poll, presence, concurrent writers, reader denial, reconnect, revocation, peer cleanup",
	)
	await stop()
	console.log("Workspace proof retained", directory)
} catch (error) {
	await Bun.write(
		join(directory, "failure.json"),
		JSON.stringify({ phase, message: String(error).slice(0, 1000) }),
	)
	console.error("Live smoke failure retained", phase, directory)
	throw error
} finally {
	socket?.close()
	await stop()
}
