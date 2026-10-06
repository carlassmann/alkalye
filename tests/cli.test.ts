import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { Signatures } from "../src/platform/signatures"
import { startServer } from "../src/server/index"
import { DocumentApi } from "../src/shared/document-api"
import { encode } from "../src/shared/base64"
import { object, string } from "../src/shared/model"
import { restoreSnapshot } from "../src/shared/document-actions"

let directory = await mkdtemp(join(tmpdir(), "alkalye-cli-documents-"))
let instance: Effect.Success<ReturnType<typeof startServer>>
beforeAll(async () => {
	instance = await Effect.runPromise(
		startServer({ port: 0, data: join(directory, "server"), build: false }),
	)
})
afterAll(async () => {
	await Effect.runPromise(instance.close())
	await rm(directory, { recursive: true, force: true })
})
function cli(
	home: string,
	args: string[],
	origin = instance.server.url.origin,
	input = "",
) {
	let child = Bun.spawn(
		["bun", "cli.ts", "--home", home, "--server", origin, ...args],
		{ stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" },
	)
	return Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]).then(([output, error, status]) => ({ output, error, status }))
}
function account(seed: number) {
	return Effect.gen(function* () {
		let identity = yield* (yield* Signatures).account(
			Redacted.make(encode(new Uint8Array(32).fill(seed))),
		)
		let anonymous = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: instance.server.url,
		})
		let challenge = yield* anonymous.authentication.challenge({
			payload: { publicKey: identity.publicKey, purpose: "bearer" },
		})
		let signature = yield* identity.signAuthentication(challenge, {
			origin: instance.server.url.origin,
			purpose: "bearer",
		})
		let login = yield* anonymous.authentication.bearerLogin({
			payload: { id: challenge.id, publicKey: identity.publicKey, signature },
		})
		let api = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: instance.server.url,
			transformClient: client =>
				HttpClient.mapRequest(
					client,
					HttpClientRequest.bearerToken(Redacted.make(login.token)),
				),
		})
		return {
			api,
			subject: identity.subject,
			secret: encode(new Uint8Array(32).fill(seed)),
		}
	})
}
function run<A, E>(
	work: Effect.Effect<A, E, Signatures | HttpClient.HttpClient>,
) {
	return Effect.runPromise(
		work.pipe(
			Effect.provide(Signatures.layer),
			Effect.provide(FetchHttpClient.layer),
		),
	)
}
async function login(home: string, secret: string) {
	let result = await cli(
		home,
		["auth", "login", "--passphrase-stdin"],
		instance.server.url.origin,
		secret,
	)
	expect(result.status).toBe(0)
	expect(result.output + result.error).not.toContain(secret)
}
function documentId(result: Awaited<ReturnType<typeof cli>>) {
	expect(result.status).toBe(0)
	return string(object(JSON.parse(result.output)).id)
}

test("CLI offline creation and updates survive restart and publish through the shared document API", async () => {
	let owner = await run(account(71))
	let home = join(directory, "offline")
	await login(home, owner.secret)
	let origin = instance.server.url.origin
	let port = instance.server.port
	await Effect.runPromise(instance.close())
	let restarted = false
	try {
		let id = documentId(
			await cli(
				home,
				["doc", "create", "--title", "Offline", "--content", "First"],
				origin,
			),
		)
		let edited = await cli(
			home,
			["doc", "update", id, "--content", "Second"],
			origin,
		)
		expect(edited.status).toBe(0)
		expect((await cli(home, ["doc", "content", id], origin)).output).toContain(
			"Second",
		)
		let cached = await cli(home, ["doc", "list"], origin)
		expect(cached.status).toBe(0)
		expect(cached.output).toContain(id)
		instance = await Effect.runPromise(
			startServer({ port, data: join(directory, "server"), build: false }),
		)
		restarted = true
		expect((await cli(home, ["sync"], origin)).status).toBe(0)
		let snapshot = await run(
			owner.api.documents.snapshot({ params: { document: id }, query: {} }),
		)
		let replica = await Effect.runPromise(restoreSnapshot(snapshot, "test"))
		expect(replica.text(id)).toContain("Second")
		let history = await run(
			owner.api.documents.history({
				params: { document: id },
				query: { after: 0, log: snapshot.log },
			}),
		)
		expect(history.map(entry => entry.action.label)).toEqual([
			"Create document",
			"Update document",
		])
	} finally {
		if (!restarted)
			instance = await Effect.runPromise(
				startServer({ port, data: join(directory, "server"), build: false }),
			)
	}
	expect((await stat(join(home, "state.sqlite"))).mode & 0o777).toBe(0o600)
})

test("two CLI processes and HTTP snapshots share source, history, undo, and current reader permissions", async () => {
	let owner = await run(account(72)),
		reader = await run(account(73))
	let home = join(directory, "owner"),
		other = join(directory, "same-account"),
		readerHome = join(directory, "reader")
	await login(home, owner.secret)
	await login(other, owner.secret)
	await login(readerHome, reader.secret)
	let id = documentId(
		await cli(home, [
			"doc",
			"create",
			"--title",
			"Shared",
			"--content",
			"Original",
			"--sync",
		]),
	)
	expect((await cli(other, ["doc", "content", id])).output).toContain(
		"Original",
	)
	expect(
		(await cli(other, ["doc", "update", id, "--content", "Changed", "--sync"]))
			.status,
	).toBe(0)
	let snapshot = await run(
		owner.api.documents.snapshot({ params: { document: id }, query: {} }),
	)
	let replica = await Effect.runPromise(restoreSnapshot(snapshot, "test"))
	expect(replica.text(id)).toContain("Changed")
	expect((await cli(other, ["doc", "undo", id])).status).toBe(0)
	expect((await cli(home, ["doc", "content", id])).output).toContain("Original")
	expect((await cli(other, ["doc", "redo", id])).status).toBe(0)
	expect((await cli(home, ["doc", "content", id])).output).toContain("Changed")
	let history = await cli(home, ["doc", "history", id])
	expect(history.status).toBe(0)
	expect(history.output).toContain("Update document")
	await run(
		owner.api.workspaces.membership({
			params: {
				workspace: "personal-" + owner.subject,
				member: reader.subject,
			},
			payload: { role: "reader", request: crypto.randomUUID() },
		}),
	)
	expect((await cli(readerHome, ["doc", "content", id])).output).toContain(
		"Changed",
	)
	expect(
		(
			await cli(readerHome, [
				"doc",
				"update",
				id,
				"--content",
				"Forbidden",
				"--sync",
			])
		).status,
	).toBe(1)
	expect((await cli(home, ["doc", "content", id])).output).toContain("Changed")
	await run(
		owner.api.workspaces.membership({
			params: {
				workspace: "personal-" + owner.subject,
				member: reader.subject,
			},
			payload: { role: null, request: crypto.randomUUID() },
		}),
	)
	expect((await cli(readerHome, ["sync"])).status).toBe(0)
})

test("CLI uses frontmatter metadata, explicit empty updates, archive lifecycle, and strict failed publication retains its ID", async () => {
	let owner = await run(account(74)),
		home = join(directory, "lifecycle")
	await login(home, owner.secret)
	let id = documentId(
		await cli(home, [
			"doc",
			"create",
			"--content=---\ntitle: From source\n---\nBody",
			"--sync",
		]),
	)
	expect((await cli(home, ["doc", "get", id])).output).toContain(
		'"title": "From source"',
	)
	expect((await cli(home, ["doc", "update", id])).status).toBe(1)
	expect(
		(await cli(home, ["doc", "update", id, "--content", "", "--sync"])).status,
	).toBe(0)
	expect((await cli(home, ["doc", "content", id])).output.trim()).toBe("")
	expect((await cli(home, ["doc", "delete", id])).status).toBe(0)
	expect((await cli(home, ["doc", "list"])).output).not.toContain(id)
	expect((await cli(home, ["doc", "restore", id])).status).toBe(0)
	expect((await cli(home, ["doc", "list"])).output).toContain(id)
	let failed = await cli(
		home,
		["doc", "create", "--content", "Retained", "--sync"],
		"http://127.0.0.1:9",
	)
	expect(failed.status).toBe(1)
	let pending = string(object(JSON.parse(failed.output)).id)
	expect(
		(await cli(home, ["doc", "content", pending], "http://127.0.0.1:9")).output,
	).toContain("Retained")
})

test("concurrent signup admits one private profile and logout preserves document datasets", async () => {
	let home = join(directory, "signup")
	let results = await Promise.all([
		cli(home, ["auth", "signup"]),
		cli(home, ["auth", "signup"]),
	])
	expect(results.map(result => result.status).sort()).toEqual([0, 1])
	let winner = results.find(result => result.status === 0)
	if (!winner) throw new Error("Missing signup winner")
	let recovery = string(object(JSON.parse(winner.output)).recoveryKey)
	expect((await cli(home, ["auth", "passphrase"])).output.trim()).toBe(recovery)
	expect((await cli(home, ["auth", "logout"])).status).toBe(0)
	expect((await cli(home, ["auth", "whoami"])).status).toBe(1)
	await login(home, recovery)
})
