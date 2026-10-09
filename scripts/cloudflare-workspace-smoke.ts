import { copyFile, mkdtemp, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Database } from "bun:sqlite"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../src/platform/signatures"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { encode } from "../src/shared/base64"
import { DocumentApi } from "../src/shared/document-api"
import {
	buildAction,
	CommittedActionSchema,
	restoreSnapshot,
	undoAction,
} from "../src/shared/document-actions"
import { cookieLogin, livePoll, liveSocket } from "../tests/live-fixture"
import type { LivePeerFixture } from "../tests/live-fixture"
import { object, parseOperation } from "../src/shared/model"
import type * as Crypto from "effect/Crypto"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"
import { blobDigest } from "../src/shared/document-blobs"
import { invitationDigest } from "../src/shared/invitations"

let root = resolve(import.meta.dir, "..")
let resumedDirectory =
	Bun.argv[2] === "--resume-migration" ? Bun.argv[3] : undefined
let directory =
	resumedDirectory ??
	(await mkdtemp(join(tmpdir(), "alkalye-cloudflare-workspaces-")))
let probeOnly = Bun.argv[2] === "--rpc-probe"
let blobCosts = Bun.argv[2] === "--blob-costs"
let largeMove = Bun.argv[2] === "--moves-large"
let moveOnly = Bun.argv[2] === "--moves" || largeMove || blobCosts
let largeMigration = Bun.argv[2] === "--legacy-migration-large"
let legacyMigration = Bun.argv[2] === "--legacy-migration" || largeMigration
let requestedOrigin = Bun.argv[2] === "--origin" ? Bun.argv[3] : undefined
if (
	!probeOnly &&
	!moveOnly &&
	!legacyMigration &&
	!resumedDirectory &&
	Bun.argv.length > 2 &&
	(!requestedOrigin || Bun.argv.length !== 4)
)
	throw Error(
		"Usage: bun scripts/cloudflare-workspace-smoke.ts [--rpc-probe|--legacy-migration|--legacy-migration-large|--moves|--moves-large]",
	)
let remote = requestedOrigin !== undefined
let origin = requestedOrigin
	? new URL(requestedOrigin).origin
	: moveOnly
		? "http://127.0.0.1:18804"
		: "http://127.0.0.1:18803"
if (remote && !origin.startsWith("https://"))
	throw Error("Remote mode requires HTTPS")
let config = join(directory, "wrangler.json")
let gateway = join(directory, "workspace-gateway.ts")
let legacyGateway = join(directory, "legacy-gateway.ts")
if (legacyMigration) {
	await symlink(
		join(root, "node_modules"),
		join(directory, "node_modules"),
		"dir",
	)
	let historical = Bun.spawn(
		["git", "show", "4792a3e:src/cloudflare/index.ts"],
		{ cwd: root, stdout: "pipe", stderr: "pipe" },
	)
	let source = await new Response(historical.stdout).text()
	ensure((await historical.exited) === 0, "Historical relay source unavailable")
	let legacyEntry = join(directory, "legacy-entry.ts")
	await Bun.write(
		legacyEntry,
		source
			.replaceAll('from "../', 'from "' + root + "/src/")
			.replaceAll('from "./', 'from "' + root + "/src/cloudflare/") +
			'\nexport { AlkalyeWorkspace } from "' +
			root +
			'/src/cloudflare/workspace-object"\n',
	)
	await Bun.write(
		legacyGateway,
		(
			await Bun.file(
				join(root, "tests/cloudflare-workspace-gateway.ts.txt"),
			).text()
		)
			.replaceAll('"../src/cloudflare/index"', JSON.stringify(legacyEntry))
			.replaceAll("../src/", root + "/src/"),
	)
}

await Bun.write(
	gateway,
	(
		await Bun.file(
			join(root, "tests/cloudflare-workspace-gateway.ts.txt"),
		).text()
	).replaceAll("../src/", root + "/src/"),
)
if (!remote && !resumedDirectory) {
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
	let configuration = Schema.decodeUnknownSync(
		Schema.Record(Schema.String, Schema.Unknown),
	)(JSON.parse(await Bun.file(config).text()))
	await Bun.write(
		config,
		JSON.stringify({
			...configuration,
			main: legacyMigration && runs === 1 ? legacyGateway : gateway,
		}),
	)
	let bundleDirectory = join(directory, `bundle-${runs}-${Date.now()}`)
	let bundleLog = Bun.file(bundleDirectory + ".log")
	let build = Bun.spawn(
		[
			"bun",
			"x",
			"--no-install",
			"wrangler",
			"deploy",
			"--dry-run",
			"--config",
			config,
			"--outdir",
			bundleDirectory,
		],
		{ cwd: root, stdout: bundleLog, stderr: bundleLog },
	)
	ensure(
		(await build.exited) === 0,
		`Worker bundle failed; retained log ${bundleLog.name}`,
	)
	let entries: string[] = []
	for await (let entry of new Bun.Glob("*.js").scan({
		cwd: bundleDirectory,
		absolute: true,
	}))
		entries.push(entry)
	ensure(entries.length === 1, "Worker bundle entry unavailable")
	await Bun.write(
		config,
		JSON.stringify({ ...configuration, main: entries[0] }),
	)

	let log = Bun.file(join(directory, `worker-${runs}-${Date.now()}.log`))
	child = Bun.spawn(
		[
			"bun",
			"x",
			"--no-install",
			"wrangler",
			"dev",
			"--no-bundle",
			"--config",
			config,
			"--local",
			"--ip",
			"127.0.0.1",
			"--port",
			new URL(origin).port,
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
	if (resumedDirectory) {
		phase = "immutable-frozen-migration-retry"
		let fixture = Schema.decodeUnknownSync(
			Schema.Struct({
				document: Schema.String,
				largeDocuments: Schema.optionalKey(Schema.Array(Schema.String)),
			}),
		)(
			JSON.parse(
				await Bun.file(join(directory, "fixture.private.json")).text(),
			),
		)
		let expected: { log: string; position: number; state: string } | undefined
		let tail: { position: number; entry: Uint8Array }[] = []
		for await (let path of new Bun.Glob("**/*.sqlite").scan({
			cwd: join(directory, "state", "v3", "do"),
			absolute: true,
		})) {
			let db = new Database(path, { readonly: true })
			try {
				let tables = db
					.query<{ name: string }, []>(
						"SELECT name FROM sqlite_master WHERE type='table'",
					)
					.all()
					.map(row => row.name)
				if (
					tables.includes("document_heads") &&
					!tables.includes("cloudflare_workspace_identity")
				) {
					expected =
						db
							.query<
								{ log: string; position: number; state: string },
								[string]
							>(
								"SELECT log,position,state FROM document_heads WHERE document=?",
							)
							.get(fixture.document) ?? undefined
					if (expected)
						tail = db
							.query<{ position: number; entry: Uint8Array }, [string, number]>(
								"SELECT a.position,j.payload entry FROM document_actions a JOIN effect_event_journal j ON j.id=a.entry WHERE a.document=? AND a.position>? ORDER BY a.position",
							)
							.all(fixture.document, expected.position)
				}
			} finally {
				db.close()
			}
		}
		ensure(expected !== undefined, "Retained frozen source missing")
		if (!expected) throw Error("Retained frozen source missing")
		let original = await run(
			restoreSnapshot(
				{
					format: "document-state-v1",
					document: fixture.document,
					...expected,
				},
				"readonly-fixture",
			),
		)
		for (let row of tail) {
			let action = Schema.decodeUnknownSync(
				SchemaBinary.toCodec(CommittedActionSchema),
			)(row.entry)
			ensure(
				action.document === fixture.document,
				"Retained action belongs to another document",
			)
			original.apply(action.changes.map(parseOperation))
			expected.position = row.position
		}
		let owner = await run(client(201))
		let result = await run(snapshot(owner, fixture.document))
		let replica = await run(restoreSnapshot(result, crypto.randomUUID()))
		await Bun.write(
			join(directory, `retry-agreement-${Date.now()}.json`),
			JSON.stringify({
				expectedLength: original.text(fixture.document).length,
				actualLength: replica.text(fixture.document).length,
				sourceEqual:
					replica.text(fixture.document) === original.text(fixture.document),
				logEqual: result.log === expected.log,
				expectedPosition: expected.position,
				actualPosition: result.position,
				tailCount: tail.length,
			}),
		)
		ensure(
			replica.text(fixture.document) === original.text(fixture.document) &&
				result.log === expected.log &&
				result.position === expected.position,
			"Migration retry changed source/log/position",
		)
		async function verifyLargeDocuments() {
			for (let [index, document] of (fixture.largeDocuments ?? []).entries()) {
				let actual = await run(
					restoreSnapshot(
						await run(snapshot(owner, document)),
						crypto.randomUUID(),
					),
				)
				ensure(
					actual.text(document) ===
						"Migration body " + index + "\n" + "x".repeat(32768),
					"Large migration changed document source",
				)
			}
		}
		await verifyLargeDocuments()
		await stop()
		await start()
		owner = await run(client(201))
		await verifyLargeDocuments()
		await stop()
		await Bun.write(
			join(directory, "retry-result.json"),
			JSON.stringify({
				passed: true,
				phase,
				largeDocuments: fixture.largeDocuments?.length ?? 0,
				coldRestart: true,
				sourceSHA: new Bun.CryptoHasher("sha256")
					.update(replica.text(fixture.document))
					.digest("hex"),
			}),
		)
		console.log("PASS immutable migration retry", directory)
		process.exit(0)
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
	let largeDocuments = largeMigration
		? Array.from({ length: 40 }, () => crypto.randomUUID())
		: []
	await Bun.write(
		join(directory, "fixture.private.json"),
		JSON.stringify({
			workspace,
			document,
			otherWorkspace,
			otherDocument,
			stage: "allocated-before-first-mutation",
			largeDocuments,
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
	let migrationBlob = new Uint8Array([0, 1, 127, 128, 255])
	let migrationDigest = encode(
		new Uint8Array(await crypto.subtle.digest("SHA-256", migrationBlob)),
	)
	if (legacyMigration)
		await run(
			owner.api.documents.putBlob({
				params: { document, digest: migrationDigest },
				payload: migrationBlob,
			}),
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
	if (moveOnly) {
		phase = "cross-workspace-move-cycle"
		let destinationWorkspace = crypto.randomUUID()
		await Bun.write(
			join(directory, "move-destination.private.json"),
			JSON.stringify({
				workspace: destinationWorkspace,
				stage: "before-create",
			}),
		)
		await run(
			reader.api.workspaces.create({
				payload: {
					workspace: destinationWorkspace,
					name: "Separate destination owner",
					request: crypto.randomUUID(),
				},
			}),
		)
		await run(
			reader.api.workspaces.membership({
				params: { workspace: destinationWorkspace, member: owner.subject },
				payload: { role: "writer", request: crypto.randomUUID() },
			}),
		)
		await exerciseMoves(
			owner,
			writer,
			reader,
			workspace,
			destinationWorkspace,
			document,
			migrationDigest,
			migrationBlob,
		)
		await Bun.write(
			join(directory, "success.json"),
			JSON.stringify({
				passed: true,
				runtime: "local workerd native workspace Durable Objects",
				phases: [
					"source-owner-permission",
					"destination-workspace-permission",
					"accepted-source-and-Undo",
					"document-invitation-routing",
					"physical-blob-preserved",
					"A-to-B-to-A",
					"original-request-receipt",
					"cold-gateway-restart",
				],
			}),
		)
		await stop()
		if (blobCosts)
			await verifyBlobCounters(document, migrationBlob.length, "returned")
		if (largeMove) await verifyLargeMoveStorage(document)
		console.log("PASS native workspace moves; proof retained", directory)
		process.exit(0)
	}
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
	if (largeMigration) {
		phase = "legacy-many-document-seed"
		for (let [index, extraDocument] of largeDocuments.entries()) {
			let content = "Migration body " + index + "\n" + "x".repeat(32768)
			let creation = await run(
				buildAction(
					new Replica(owner.subject + "-" + crypto.randomUUID()),
					extraDocument,
					"Create",
					staged => newDocument(staged, extraDocument, "Untitled", content),
				),
			)
			await run(
				owner.api.documents.create({
					payload: { workspace, action: creation },
				}),
			)
		}
	}
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
		let beforeMigration = await run(snapshot(owner, document))
		let receiptBefore = await run(
			owner.api.documents.action({ params: { document, action: first.id } }),
		)

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
		if (legacyMigration) {
			let restoredBlob = await run(
				owner.api.documents.getBlob({
					params: { document, digest: migrationDigest },
				}),
			)
			ensure(
				restoredBlob.length === migrationBlob.length &&
					restoredBlob.every((byte, index) => byte === migrationBlob[index]),
				"Migration changed blob bytes",
			)
			for (let [index, extraDocument] of largeDocuments.entries()) {
				let restored = await run(
					restoreSnapshot(
						await run(snapshot(owner, extraDocument)),
						crypto.randomUUID(),
					),
				)
				ensure(
					restored.text(extraDocument) ===
						"Migration body " + index + "\n" + "x".repeat(32768),
					"Large migration document differs",
				)
			}
			let afterMigration = await run(snapshot(owner, document))
			let receiptAfter = await run(
				owner.api.documents.action({ params: { document, action: first.id } }),
			)
			ensure(
				afterMigration.log === beforeMigration.log &&
					afterMigration.position === beforeMigration.position,
				"Migration changed document log/position",
			)
			ensure(
				JSON.stringify(receiptAfter) === JSON.stringify(receiptBefore),
				"Migration changed accepted action",
			)
			ensure(
				(await run(
					owner.api.documents.commit({ params: { document }, payload: first }),
				)) === accepted[0],
				"Migration duplicate action lost original position",
			)
			let undo = await run(
				undoAction(
					reopened,
					receiptAfter,
					owner.subject + "-" + crypto.randomUUID(),
				),
			)
			await run(
				owner.api.documents.commit({ params: { document }, payload: undo }),
			)
			let undone = await run(
				restoreSnapshot(
					await run(snapshot(owner, document)),
					crypto.randomUUID(),
				),
			)
			ensure(
				undone.text(document) === source + " WRITER",
				"Migrated Undo changed peer contribution",
			)
			text = undone.text(document)
			let secondary = await run(
				restoreSnapshot(
					await run(snapshot(owner, otherDocument)),
					crypto.randomUUID(),
				),
			)
			ensure(
				secondary.text(otherDocument) === otherSource,
				"Second legacy workspace migration differs",
			)
			ensure(
				(await run(snapshot(reader, document).pipe(Effect.result)))._tag ===
					"Failure",
				"Migration restored revoked membership",
			)
		}

		socket.close()
		socket = undefined
		await polling.close()
		polling = undefined
	}

	if (legacyMigration) {
		phase = "migrated-current-cold-restart"
		await stop()
		await start()
		let restored = await run(
			restoreSnapshot(
				await run(snapshot(owner, document)),
				crypto.randomUUID(),
			),
		)
		ensure(
			restored.text(document) === text,
			"Post-migration restart lost accepted Undo",
		)
		let independent = await run(
			restoreSnapshot(
				await run(snapshot(owner, otherDocument)),
				crypto.randomUUID(),
			),
		)
		ensure(
			independent.text(otherDocument) === otherSource,
			"Post-migration restart crossed workspace source",
		)
		ensure(
			(await run(snapshot(reader, document).pipe(Effect.result)))._tag ===
				"Failure",
			"Post-migration restart restored revoked reader",
		)
	}
	phase = "closed-native-sqlite-partitions"
	await stop()
	let partitions: {
		workspace: string | null
		first: number
		second: number
		fences: number
		receipts: number
		exportBytes: number
		maximumChunk: number
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
			let fences = tables.includes("workspace_transfer_fences")
				? (database
						.query<{ count: number }, [string, string]>(
							"SELECT COUNT(*) count FROM workspace_transfer_fences WHERE workspace IN (?,?)",
						)
						.get(workspace, otherWorkspace)?.count ?? 0)
				: 0
			let receipts = tables.includes("workspace_transfer_receipts")
				? (database
						.query<{ count: number }, [string, string]>(
							"SELECT COUNT(*) count FROM workspace_transfer_receipts WHERE workspace IN (?,?)",
						)
						.get(workspace, otherWorkspace)?.count ?? 0)
				: 0
			let exportBytes = tables.includes("workspace_transfer_export_manifests")
				? (database
						.query<{ size: number | null }, [string]>(
							"SELECT MAX(bytes) size FROM workspace_transfer_export_manifests WHERE workspace=?",
						)
						.get(workspace)?.size ?? 0)
				: 0
			let maximumChunk = tables.includes("workspace_transfer_export_chunks")
				? (database
						.query<{ size: number | null }, [string]>(
							"SELECT MAX(length(payload)) size FROM workspace_transfer_export_chunks WHERE workspace=?",
						)
						.get(workspace)?.size ?? 0)
				: 0
			partitions.push({
				workspace: binding,
				first,
				second,
				fences,
				receipts,
				exportBytes,
				maximumChunk,
			})
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
			.every(row =>
				legacyMigration
					? row.first + row.second === 0 || row.fences === 2
					: row.first === 0 && row.second === 0,
			),
		"Primary database retained new document bodies",
	)
	if (legacyMigration)
		ensure(
			partitions
				.filter(row => row.workspace !== null)
				.every(row => row.receipts === 1),
			"Migration receipt missing or duplicate",
		)
	if (largeMigration) {
		ensure(
			partitions.some(row => row.exportBytes > 2 * 1024 * 1024),
			"Large migration export did not exceed native SQLite row limit",
		)
		ensure(
			partitions.every(row => row.maximumChunk <= 256 * 1024),
			"Workspace export chunk exceeded bound",
		)
	}
	await Bun.write(
		join(directory, "result.json"),
		JSON.stringify({
			passed: true,
			legacyMigration,
			largeMigration,
			phases: [
				"two-workspaces-isolated-native-sqlite",
				...(legacyMigration
					? [
							"historical-relay-composition-cutover",
							"exact-log-position-receipt",
							"duplicate-action-idempotency",
							"binary-blob-preserved",
							"migrated-undo-preserves-peer",
							"post-migration-cold-restart",
							"source-fences-target-receipts",
						]
					: []),
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
				exportBytes: Math.max(...partitions.map(row => row.exportBytes)),
				maximumExportChunk: Math.max(
					...partitions.map(row => row.maximumChunk),
				),
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

async function exerciseMoves(
	owner: Client,
	writer: Client,
	reader: Client,
	from: string,
	to: string,
	document: string,
	digest: string,
	bytes: Uint8Array,
) {
	let outward = crypto.randomUUID(),
		back = crypto.randomUUID(),
		invitation = crypto.randomUUID(),
		secret = encode(crypto.getRandomValues(new Uint8Array(32)))
	await Bun.write(
		join(directory, "moves.private.json"),
		JSON.stringify({
			document,
			from,
			to,
			outward,
			back,
			invitation,
			secret,
			stage: "before-mutation",
		}),
	)
	if (largeMove) await seedMoveHistory(owner, document)
	let initial = await run(snapshot(owner, document))
	let initialSource = (await run(restoreSnapshot(initial, "reader"))).text(
		document,
	)
	await run(
		owner.api.documents.putBlob({
			params: { document, digest },
			payload: bytes,
		}),
	)
	if (blobCosts) {
		let unknown = await run(
			Effect.forEach(
				Array.from({ length: 220 }, (_, index) => index),
				index =>
					blobDigest(new Uint8Array([index])).pipe(
						Effect.map(digest => ({ digest, size: 1 })),
					),
			),
		)
		let missing = await run(
			owner.api.documents.missingBlobs({
				params: { document },
				payload: [{ digest, size: bytes.length }, ...unknown],
			}),
		)
		ensure(
			JSON.stringify(missing) ===
				JSON.stringify(unknown.map(chunk => chunk.digest)),
			"Native descriptor discovery lost or misclassified chunks",
		)
		await Bun.write(
			join(directory, "blob-descriptors.json"),
			JSON.stringify({
				passed: true,
				descriptors: 221,
				known: 1,
				missing: missing.length,
			}),
		)
	}
	await run(
		owner.api.invitations.create({
			payload: {
				invitation,
				target: { document },
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
	let peer = await run(insert(writer, document, " PEER"))
	await run(
		writer.api.documents.commit({ params: { document }, payload: peer }),
	)
	let edit = await run(insert(owner, document, " OWN"))
	await run(owner.api.documents.commit({ params: { document }, payload: edit }))
	ensure(
		(
			await run(
				writer.api.documents
					.move({
						params: { document },
						payload: { workspace: to, request: crypto.randomUUID() },
					})
					.pipe(Effect.result),
			)
		)._tag === "Failure",
		"Non-owner moved document",
	)
	let sourcePeer = livePoll(await cookieLogin(new URL(origin), 202))
	await sourcePeer.open()
	await sourcePeer.until(message => message.type === "connected")
	ensure(
		(await sourcePeer.send([{ type: "watch", document }])) === 204,
		"Source peer watch failed",
	)
	let receipt = await run(
		owner.api.documents.move({
			params: { document },
			payload: { workspace: to, request: outward },
		}),
	)
	ensure(
		(await run(
			owner.api.documents.move({
				params: { document },
				payload: { workspace: to, request: outward },
			}),
		)) === receipt,
		"Repeated move changed receipt",
	)
	await sourcePeer.until(
		message => message.type === "unavailable" && message.document === document,
	)
	ensure((await sourcePeer.close()) === 204, "Source peer close failed")
	let moved = await run(snapshot(owner, document))
	ensure(moved.log !== initial.log, "Move did not rotate log")
	ensure(
		(await run(restoreSnapshot(moved, "reader"))).text(document) ===
			initialSource + " PEER OWN",
		"Move changed accepted source",
	)
	ensure(
		(
			await run(
				restoreSnapshot(await run(snapshot(reader, document)), "reader"),
			)
		).text(document) ===
			initialSource + " PEER OWN",
		"Moved document invitation lost access",
	)
	let action = await run(
		owner.api.documents.action({ params: { document, action: edit.id } }),
	)
	ensure(action.id === edit.id, "Move changed action identity")
	let undone = await run(
		undoAction(
			await run(restoreSnapshot(moved, "undo")),
			action,
			owner.subject + "-" + crypto.randomUUID(),
		),
	)
	await run(
		owner.api.documents.commit({ params: { document }, payload: undone }),
	)
	ensure(
		(
			await run(restoreSnapshot(await run(snapshot(owner, document)), "reader"))
		).text(document) ===
			initialSource + " PEER",
		"Moved Undo lost peer edit",
	)
	let blob = await run(
		owner.api.documents.getBlob({ params: { document, digest } }),
	)
	ensure(
		blob.length === bytes.length &&
			blob.every((byte, index) => byte === bytes[index]),
		"Move lost blob bytes",
	)
	await stop()
	if (blobCosts) await verifyBlobCounters(document, bytes.length, "outward")
	await start()
	ensure(
		(await run(
			owner.api.documents.move({
				params: { document },
				payload: { workspace: to, request: outward },
			}),
		)) === receipt,
		"Cold gateway lost original receipt",
	)
	let beforeBack = await run(snapshot(owner, document))
	let returned = await run(
		owner.api.documents.move({
			params: { document },
			payload: { workspace: from, request: back },
		}),
	)
	ensure(returned > 0, "Return move receipt invalid")
	let returnedSnapshot = await run(snapshot(owner, document))
	ensure(
		returnedSnapshot.log !== beforeBack.log,
		"Return move did not rotate log",
	)
	ensure(
		(await run(restoreSnapshot(returnedSnapshot, "reader"))).text(document) ===
			initialSource + " PEER",
		"Cyclic move changed source",
	)
	ensure(
		(await run(
			owner.api.documents.move({
				params: { document },
				payload: { workspace: to, request: outward },
			}),
		)) === receipt,
		"Historical retry moved current pointer",
	)
	let description = await run(
		owner.api.invitations.describe({
			params: { invitation },
			payload: { secret },
		}),
	)
	ensure(description.kind === "document", "Moved invitation target changed")
	await stop()
	await start()
	ensure(
		(await run(
			owner.api.documents.move({
				params: { document },
				payload: { workspace: from, request: back },
			}),
		)) === returned,
		"Cold cycle lost return receipt",
	)
	ensure(
		(
			await run(restoreSnapshot(await run(snapshot(owner, document)), "reader"))
		).text(document) ===
			initialSource + " PEER",
		"Cold cycle changed source",
	)
	let restoredBlob = await run(
		owner.api.documents.getBlob({ params: { document, digest } }),
	)
	ensure(
		restoredBlob.length === bytes.length &&
			restoredBlob.every((byte, index) => byte === bytes[index]),
		"Cold cycle lost blob",
	)
}

async function seedMoveHistory(owner: Client, document: string) {
	for (let index = 0; index < 32; index++) {
		let action = await run(
			buildAction(
				await run(
					restoreSnapshot(
						await run(snapshot(owner, document)),
						owner.subject + "-" + crypto.randomUUID(),
					),
				),
				document,
				"Edit body and presentation note",
				staged => [
					staged.edit(document, (index % 2 ? "a" : "b").repeat(8192)),
					staged.set(
						document,
						"presentationNote",
						String(index).padStart(4, "0") + "note ".repeat(13107),
					),
				],
			),
		)
		await Bun.write(
			join(directory, "move-history-" + index + ".private.json"),
			JSON.stringify({ action: action.id, stage: "before-commit" }),
		)
		await run(
			owner.api.documents.commit({ params: { document }, payload: action }),
		)
	}
}
async function verifyLargeMoveStorage(document: string) {
	let copies = await mkdtemp(join(tmpdir(), "alkalye-move-readback-"))
	let file = 0
	let witnesses: {
		historyBytes: number
		exportBytes: number
		maximumChunk: number
		chunks: number
	}[] = []
	for await (let path of new Bun.Glob("**/*.sqlite").scan({
		cwd: join(directory, "state", "v3", "do"),
		absolute: true,
	})) {
		if (path.endsWith("/metadata.sqlite")) continue
		let copied = join(copies, String(file++) + ".sqlite")
		await copyFile(path, copied)
		if (await Bun.file(path + "-wal").exists())
			await copyFile(path + "-wal", copied + "-wal")
		let database = new Database(copied, { readwrite: true, create: false })
		try {
			let tables = database
				.query<{ name: string }, []>(
					"SELECT name FROM sqlite_master WHERE type='table'",
				)
				.all()
				.map(row => row.name)
			if (!tables.includes("document_move_export_chunks")) continue
			let historyBytes =
				database
					.query<{ bytes: number }, [string]>(
						"SELECT COALESCE(SUM(length(j.payload)),0) bytes FROM document_actions a JOIN effect_event_journal j ON j.id=a.entry WHERE a.document=?",
					)
					.get(document)?.bytes ?? 0
			let exports = database
				.query<{ bytes: number; maximum: number; chunks: number }, [string]>(
					"SELECT COALESCE(SUM(length(payload)),0) bytes,COALESCE(MAX(length(payload)),0) maximum,COUNT(*) chunks FROM document_move_export_chunks WHERE document=?",
				)
				.get(document)
			if (exports && exports.chunks > 0)
				witnesses.push({
					historyBytes,
					exportBytes: exports.bytes,
					maximumChunk: exports.maximum,
					chunks: exports.chunks,
				})
		} finally {
			database.close()
		}
	}
	ensure(witnesses.length >= 2, "Both workspace move caches missing")
	ensure(
		witnesses.every(
			row =>
				row.historyBytes > 2 * 1024 * 1024 &&
				row.exportBytes > 2 * 1024 * 1024 &&
				row.maximumChunk <= 256 * 1024,
		),
		"Large history/chunk mechanism gate failed",
	)
	await Bun.write(
		join(directory, "large-move-storage.json"),
		JSON.stringify(
			{
				passed: true,
				seedActions: 32,
				history: "body replacement plus presentation-note register",
				witnesses,
			},
			null,
			2,
		),
	)
}

async function verifyBlobCounters(
	document: string,
	expectedSize: number,
	stage: string,
) {
	let witnesses: {
		retired: boolean
		rawDocumentBytes: number
		activeServerBytes: number
		accounts: number
	}[] = []
	for await (let path of new Bun.Glob("**/*.sqlite").scan({
		cwd: join(directory, "state", "v3", "do"),
		absolute: true,
	})) {
		let database = new Database(path, { readonly: true })
		try {
			let tables = database
				.query<{ name: string }, []>(
					"SELECT name FROM sqlite_master WHERE type='table'",
				)
				.all()
			if (!tables.some(row => row.name === "document_blob_document_usage"))
				continue
			let raw = database
				.query<{ size: number }, [string]>(
					"SELECT size FROM document_blob_document_usage WHERE document=?",
				)
				.get(document)
			if (!raw) continue
			ensure(
				raw.size === expectedSize,
				"Native retained document bytes changed",
			)
			let retired =
				database
					.query<{ phase: string }, [string]>(
						"SELECT phase FROM document_transfer_fences WHERE document=?",
					)
					.get(document)?.phase === "retired"
			let server = database
				.query<{ size: number }, []>(
					"SELECT size FROM document_blob_server_usage WHERE singleton=1",
				)
				.get()
			let expected = database
				.query<{ size: number }, []>(
					"SELECT COALESCE(SUM(CASE WHEN b.external=1 THEN b.size ELSE length(b.bytes) END),0) AS size FROM document_blobs b WHERE NOT EXISTS(SELECT 1 FROM document_transfer_fences f WHERE f.document=b.document AND f.phase='retired')",
				)
				.get()
			ensure(
				server?.size === expected?.size,
				"Native server counter disagrees with retained active bytes",
			)
			let accounts = database
				.query<{ owner: string; size: number }, []>(
					"SELECT owner,size FROM document_blob_account_usage",
				)
				.all()
			for (let account of accounts) {
				let expectedAccount = database
					.query<{ size: number }, [string]>(
						"SELECT COALESCE(SUM(CASE WHEN b.external=1 THEN b.size ELSE length(b.bytes) END),0) AS size FROM document_blobs b JOIN workspace_documents d ON d.document=b.document JOIN workspaces w ON w.workspace=d.workspace WHERE w.owner=? AND NOT EXISTS(SELECT 1 FROM document_transfer_fences f WHERE f.document=b.document AND f.phase='retired')",
					)
					.get(account.owner)
				ensure(
					account.size === expectedAccount?.size,
					"Native account counter disagrees with current workspace ownership",
				)
			}
			if (!server) throw Error("Native server counter missing")
			ensure(
				!retired || server.size === 0,
				"Retired source still consumes native server quota",
			)
			witnesses.push({
				retired,
				rawDocumentBytes: raw.size,
				activeServerBytes: server.size,
				accounts: accounts.length,
			})
		} finally {
			database.close()
		}
	}
	ensure(
		witnesses.length === 2 && witnesses.filter(row => row.retired).length === 1,
		"Native active/retired workspace witnesses missing",
	)
	await Bun.write(
		join(directory, `blob-counters-${stage}.json`),
		JSON.stringify({ passed: true, witnesses }, null, 2),
	)
}
