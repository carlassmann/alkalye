import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { connect } from "node:tls"
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

let root = resolve(import.meta.dir, "..")
let directory = await mkdtemp(join(tmpdir(), "alkalye-cloudflare-live-"))
let requestedOrigin = Bun.argv[2] === "--origin" ? Bun.argv[3] : undefined
if (Bun.argv.length > 2 && (!requestedOrigin || Bun.argv.length !== 4))
	throw Error(
		"Usage: bun scripts/cloudflare-live-smoke.ts [--origin https://host]",
	)
let remote = requestedOrigin !== undefined
let origin = requestedOrigin
	? new URL(requestedOrigin).origin
	: "http://127.0.0.1:18802"
if (remote && !origin.startsWith("https://"))
	throw Error("Remote mode requires HTTPS")
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
			"18802",
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
function socketPeer(login: LiveLogin): Promise<LivePeerFixture> {
	if (login.base.protocol !== "https:") return liveSocket(login)
	return new Promise((resolve, reject) => {
		let buffer = Buffer.alloc(0),
			upgraded = false
		let inbox: LiveMessage[] = []
		let waiters: {
			resolve(message: LiveMessage): void
			reject(error: Error): void
		}[] = []
		let socket = connect(
			{
				host: login.base.hostname,
				port: Number(login.base.port) || 443,
				servername: login.base.hostname,
			},
			() => {
				socket.write(
					[
						`GET /api/live?account=${encodeURIComponent(login.subject)} HTTP/1.1`,
						`Host: ${login.base.host}`,
						`Origin: ${login.base.origin}`,
						`Cookie: ${login.cookie}`,
						"Connection: Upgrade",
						"Upgrade: websocket",
						"Sec-WebSocket-Version: 13",
						"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
						"",
						"",
					].join("\r\n"),
				)
			},
		)
		let timeout = setTimeout(
			() => fail(Error("Remote websocket upgrade timed out")),
			30000,
		)
		function fail(error: Error) {
			clearTimeout(timeout)
			socket.destroy()
			reject(error)
			for (let waiter of waiters.splice(0)) waiter.reject(error)
		}
		socket.on("error", fail)
		socket.on("close", () => fail(Error("Remote websocket closed")))
		socket.on("data", (bytes: Buffer) => {
			buffer = Buffer.concat([buffer, bytes])
			if (!upgraded) {
				let end = buffer.indexOf("\r\n\r\n")
				if (end < 0) return
				let head = buffer.subarray(0, end).toString()
				if (!head.includes(" 101 "))
					return fail(
						Error(
							"Remote websocket upgrade rejected: " + head.split("\r\n")[0],
						),
					)
				buffer = buffer.subarray(end + 4)
				upgraded = true
				clearTimeout(timeout)
				resolve({ inbox, send, until, close: () => socket.destroy() })
			}
			while (buffer.length >= 2) {
				let opcode = buffer.readUInt8(0) & 15,
					length = buffer.readUInt8(1) & 127,
					offset = 2
				if (length === 127)
					return fail(Error("Remote live frame exceeds bounded protocol"))
				if (length === 126) {
					if (buffer.length < 4) return
					length = buffer.readUInt16BE(2)
					offset = 4
				}
				if (buffer.length < offset + length) return
				let payload = buffer.subarray(offset, offset + length)
				buffer = buffer.subarray(offset + length)
				if (opcode === 8)
					return fail(Error("Remote server closed live channel"))
				if (opcode === 9) {
					frame(10, payload)
					continue
				}
				if (opcode !== 1) continue
				try {
					let value = object(JSON.parse(payload.toString()))
					let message = {
						...value,
						type: Schema.decodeUnknownSync(Schema.String)(value.type),
					}
					let waiter = waiters.shift()
					if (waiter) waiter.resolve(message)
					else inbox.push(message)
				} catch (error) {
					fail(Error("Malformed remote live message: " + String(error)))
					return
				}
			}
		})
		function frame(opcode: number, payload: Buffer) {
			let mask = crypto.getRandomValues(new Uint8Array(4))
			let header =
				payload.length < 126
					? Buffer.from([0x80 | opcode, 0x80 | payload.length])
					: Buffer.from([
							0x80 | opcode,
							0xfe,
							payload.length >> 8,
							payload.length & 255,
						])
			let encoded = Buffer.from(payload)
			for (let index = 0; index < encoded.length; index++)
				encoded[index] = encoded.readUInt8(index) ^ (mask[index % 4] ?? 0)
			socket.write(Buffer.concat([header, Buffer.from(mask), encoded]))
		}
		function send(message: unknown) {
			frame(1, Buffer.from(JSON.stringify(message)))
		}
		async function until(match: (message: LiveMessage) => boolean) {
			while (true) {
				let message =
					inbox.shift() ??
					(await new Promise<LiveMessage>((resolve, reject) => {
						let timer = setTimeout(
							() => fail(Error("No matching remote live message")),
							10000,
						)
						waiters.push({
							resolve: message => {
								clearTimeout(timer)
								resolve(message)
							},
							reject: error => {
								clearTimeout(timer)
								reject(error)
							},
						})
					}))
				if (match(message)) return message
			}
		}
	})
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
		return { api, subject: login.subject }
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
let phase = "startup"
let socket: LivePeerFixture | undefined
let polling: ReturnType<typeof livePoll> | undefined
try {
	await start()
	phase = "authenticated-clients"
	let [owner, writer, reader] = await Promise.all([
		run(client(201)),
		run(client(202)),
		run(client(203)),
	])
	let workspace = crypto.randomUUID(),
		document = crypto.randomUUID()
	await run(
		owner.api.workspaces.create({
			payload: {
				workspace,
				name: "Cloudflare live proof",
				request: crypto.randomUUID(),
			},
		}),
	)
	for (let [account, role] of [
		[writer, "writer"],
		[reader, "reader"],
	] satisfies [Client, "writer" | "reader"][]) {
		await run(
			owner.api.workspaces.membership({
				params: { workspace, member: account.subject },
				payload: { role, request: crypto.randomUUID() },
			}),
		)
	}
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
	phase = "real-websocket-and-poll-open"
	let readerLogin = await cookieLogin(new URL(origin), 203)
	polling = livePoll(readerLogin)
	await polling.open()
	let readerActor = (
		await polling.until(message => message.type === "connected")
	).actor
	socket = await socketPeer(await cookieLogin(new URL(origin), 201))
	let ownerActor = (await socket.until(message => message.type === "connected"))
		.actor
	ensure(ownerActor !== readerActor, "Peer actors must be unique")
	ensure(
		(await polling.send([{ type: "watch", document }])) === 204,
		"Reader watch failed",
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
	phase = "revocation"
	await run(
		owner.api.workspaces.membership({
			params: { workspace, member: reader.subject },
			payload: { role: null, request: crypto.randomUUID() },
		}),
	)
	await polling.until(
		message => message.type === "unavailable" && message.document === document,
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
		socket = await socketPeer(ownerLogin)
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

	await Bun.write(
		join(directory, "result.json"),
		JSON.stringify({
			passed: true,
			phases: [
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
		}),
	)
	console.log(
		"PASS real Cloudflare live: WS/poll, presence, concurrent writers, reader denial, reconnect, revocation, peer cleanup",
	)
	await stop()
	await rm(directory, { recursive: true, force: true })
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
