import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../src/platform/signatures"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { startServer } from "../src/server/index"
import { encode } from "../src/shared/base64"
import { DocumentApi } from "../src/shared/document-api"
import { object } from "../src/shared/model"

let directory = await mkdtemp(join(tmpdir(), "alkalye-account-agents-"))
let instance: Effect.Success<ReturnType<typeof startServer>>
beforeAll(async () => {
	instance = await Effect.runPromise(
		startServer({ port: 0, data: directory, build: false }),
	)
})
afterAll(async () => {
	await Effect.runPromise(instance.close())
	await rm(directory, { recursive: true, force: true })
})

test("account agent tools share document snapshots, discussion history and exact revisions", async () => {
	let owner = await run(account(1))
	await run(
		owner.api.workspaces.create({
			payload: {
				workspace: "personal-" + owner.subject,
				name: "Personal",
				request: "personal-v1",
			},
		}),
	)
	let agent = await run(
		owner.api.agents.create({
			payload: { name: "Teaching agent", workspaces: "all", ceiling: "owner" },
		}),
	)
	let created = await call(agent.token, "create_document", {
		title: "Native title",
		content: "Quote",
	})
	let document = String(created.documentId)
	expect(created.success).toBe(true)
	let read = await call(agent.token, "get_document", { documentId: document })
	expect(read.content).toBe('---\ntitle: "Native title"\n---\nQuote')
	expect(read.revision).toBe(created.revision)
	let commented = await call(agent.token, "add_comment", {
		documentId: document,
		quote: "Quote",
		body: "Discuss",
	})
	expect(commented.revision).not.toBe(read.revision)
	let stale = await response(agent.token, "update_document", {
		documentId: document,
		content: "Overwrite",
		expectedRevision: read.revision,
	})
	expect(stale.isError).toBe(true)
	let comments = await call(agent.token, "list_comments", {
		documentId: document,
	})
	let comment = object(
		Array.isArray(comments.comments) ? comments.comments[0] : undefined,
	)
	await call(agent.token, "reply_to_comment", {
		documentId: document,
		commentId: comment.commentId,
		body: "Reply",
	})
	await call(agent.token, "set_comment_resolved", {
		documentId: document,
		commentId: comment.commentId,
		resolved: true,
	})
	let snapshot = await run(
		owner.api.documents.snapshot({ params: { document } }),
	)
	let history = await run(
		owner.api.documents.history({
			params: { document },
			query: { log: snapshot.log, after: 0 },
		}),
	)
	expect(history.map(moment => moment.action.label)).toEqual([
		"Agent create",
		"Agent comment",
		"Agent reply",
		"Agent resolve comment",
	])
	let latest = await call(agent.token, "get_document", { documentId: document })
	await call(agent.token, "rename_document", {
		documentId: document,
		title: "Renamed",
		expectedRevision: latest.revision,
	})
	let renamed = await call(agent.token, "get_document", {
		documentId: document,
	})
	let unchanged = await call(agent.token, "rename_document", {
		documentId: document,
		title: "Renamed",
		expectedRevision: renamed.revision,
	})
	expect(unchanged.revision).toBe(renamed.revision)
	expect(
		(await run(owner.api.workspaces.library())).documents.find(
			entry => entry.document === document,
		)?.metadata.title,
	).toBe("Renamed")
	let connections = await run(owner.api.agents.list())
	expect(connections.map(connection => connection.name)).toContain(
		"Teaching agent",
	)
	let connection = connections.find(
		connection => connection.name === "Teaching agent",
	)
	if (!connection) throw new Error("Missing connection")
	await run(owner.api.agents.revoke({ params: { id: connection.id } }))
	let denied = await requestMcp(agent.token, "get_document", {
		documentId: document,
	})
	expect(denied.status).toBe(401)
})

test("native OAuth consent requires a browser session; PKCE and refresh retain only current grants", async () => {
	let owner = await run(account(4))
	let member = await browserAccount(5)
	for (let workspace of ["oauth-retained", "oauth-revoked"]) {
		await run(
			owner.api.workspaces.create({
				payload: { workspace, name: workspace, request: "create-" + workspace },
			}),
		)
		await run(
			owner.api.workspaces.membership({
				params: { workspace, member: member.subject },
				payload: { role: "writer", request: "share-" + workspace },
			}),
		)
	}
	let registered = await fetch(
		new URL("/oauth/register", instance.server.url),
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				client_name: "Native OAuth",
				redirect_uris: ["http://127.0.0.1/callback"],
			}),
		},
	)
	expect(registered.status).toBe(201)
	let client = String(object(await registered.json()).client_id)
	let verifier = "v".repeat(43)
	let resource = new URL("/mcp", instance.server.url).href
	let authorize = new URL("/oauth/authorize", instance.server.url)
	authorize.search = new URLSearchParams({
		client_id: client,
		redirect_uri: "http://127.0.0.1/callback",
		code_challenge: await run(instance.cipher.hash(verifier)),
		code_challenge_method: "S256",
		response_type: "code",
		resource,
		scope: "documents offline_access",
		state: "original-state",
	}).toString()
	let redirect = await fetch(authorize, { redirect: "manual" })
	expect(redirect.status).toBe(302)
	let request =
		new URL(redirect.headers.get("location") ?? "").searchParams.get("oauth") ??
		""
	let bearerConsent = await run(
		owner.api.agents
			.describeConsent({ query: { request } })
			.pipe(Effect.result),
	)
	expect(bearerConsent._tag === "Failure" && bearerConsent.failure._tag).toBe(
		"AuthenticationRequired",
	)
	let described = await run(
		member.api.agents.describeConsent({ query: { request } }),
	)
	expect(described.name).toBe("Native OAuth")
	let approved = await run(
		member.api.agents.consent({
			payload: {
				request,
				approve: true,
				workspaces: ["oauth-retained", "oauth-revoked"],
				ceiling: "writer",
			},
		}),
	)
	let callback = new URL(approved.redirect)
	expect(callback.searchParams.get("state")).toBe("original-state")
	let code = callback.searchParams.get("code") ?? ""
	function exchange(fields: Record<string, string>) {
		return fetch(new URL("/oauth/token", instance.server.url), {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ client_id: client, resource, ...fields }),
		})
	}
	expect(
		(
			await exchange({
				grant_type: "authorization_code",
				code,
				code_verifier: "wrong".repeat(10),
				redirect_uri: callback.origin + callback.pathname,
			})
		).status,
	).toBe(400)
	let issued = await exchange({
		grant_type: "authorization_code",
		code,
		code_verifier: verifier,
		redirect_uri: callback.origin + callback.pathname,
	})
	expect(issued.status).toBe(200)
	let tokens = object(await issued.json())
	let created = await call(String(tokens.access_token), "create_document", {
		title: "OAuth document",
		content: "Content",
		spaceId: "oauth-retained",
	})
	expect(created.success).toBe(true)
	await run(
		owner.api.workspaces.membership({
			params: { workspace: "oauth-revoked", member: member.subject },
			payload: { role: null, request: "revoke-oauth-workspace" },
		}),
	)
	let rotated = await exchange({
		grant_type: "refresh_token",
		refresh_token: String(tokens.refresh_token),
	})
	expect(rotated.status).toBe(200)
	let renewed = object(await rotated.json())
	let listed = await call(String(renewed.access_token), "list_documents", {})
	expect(
		Array.isArray(listed.spaces) &&
			listed.spaces.map(space => object(space).spaceId),
	).toEqual(["oauth-retained"])
	expect(
		(await requestMcp(String(tokens.access_token), "list_documents", {}))
			.status,
	).toBe(401)
	expect(
		(
			await exchange({
				grant_type: "refresh_token",
				refresh_token: String(tokens.refresh_token),
			})
		).status,
	).toBe(400)
	expect(
		(await requestMcp(String(renewed.access_token), "list_documents", {}))
			.status,
	).toBe(401)
})

test("agent grants attenuate live authority, isolate accounts and cannot authenticate as account sessions", async () => {
	let owner = await run(account(2))
	let stranger = await run(account(3))
	await run(
		owner.api.workspaces.create({
			payload: {
				workspace: "chosen",
				name: "Chosen",
				request: "create-chosen",
			},
		}),
	)
	await run(
		owner.api.workspaces.create({
			payload: {
				workspace: "excluded",
				name: "Excluded",
				request: "create-excluded",
			},
		}),
	)
	let agent = await run(
		owner.api.agents.create({
			payload: { name: "Scoped", workspaces: ["chosen"], ceiling: "writer" },
		}),
	)
	let created = await call(agent.token, "create_document", {
		title: "Scoped document",
		content: "Source",
		spaceId: "chosen",
	})
	let listed = await call(agent.token, "list_documents", {})
	expect(listed.personal).toEqual([])
	expect(
		Array.isArray(listed.spaces) &&
			listed.spaces.map(space => object(space).spaceId),
	).toEqual(["chosen"])
	expect(
		(
			await response(agent.token, "create_document", {
				title: "Forbidden",
				content: "Source",
				spaceId: "excluded",
			})
		).isError,
	).toBe(true)
	expect(
		(
			await response(agent.token, "rename_space", {
				spaceId: "chosen",
				name: "Forbidden",
			})
		).isError,
	).toBe(true)
	let reader = await run(
		owner.api.agents.create({
			payload: { name: "Reader", workspaces: ["chosen"], ceiling: "reader" },
		}),
	)
	expect(
		(
			await call(reader.token, "get_document", {
				documentId: created.documentId,
			})
		).content,
	).toContain("Source")
	expect(
		(
			await response(reader.token, "update_document", {
				documentId: created.documentId,
				content: "Forbidden",
				expectedRevision: created.revision,
			})
		).isError,
	).toBe(true)
	let accountResponse = await fetch(
		new URL("/api/accounts/session", instance.server.url),
		{ headers: { Authorization: "Bearer " + reader.token } },
	)
	expect(accountResponse.status).toBe(401)
	let connection = (await run(owner.api.agents.list())).find(
		connection => connection.name === "Scoped",
	)
	if (!connection) throw new Error("Missing connection")
	let revoked = await run(
		stranger.api.agents
			.revoke({ params: { id: connection.id } })
			.pipe(Effect.result),
	)
	expect(revoked._tag).toBe("Failure")
	expect((await requestMcp(agent.token, "list_documents", {})).status).toBe(200)
	await run(
		owner.api.workspaces.membership({
			params: { workspace: "chosen", member: stranger.subject },
			payload: { role: "writer", request: "invite-writer" },
		}),
	)
	let delegated = await run(
		stranger.api.agents.create({
			payload: {
				name: "Member agent",
				workspaces: ["chosen"],
				ceiling: "owner",
			},
		}),
	)
	expect(
		(
			await call(delegated.token, "get_document", {
				documentId: created.documentId,
			})
		).content,
	).toContain("Source")
	await run(
		owner.api.workspaces.membership({
			params: { workspace: "chosen", member: stranger.subject },
			payload: { role: null, request: "remove-writer" },
		}),
	)
	expect(
		(
			await requestMcp(delegated.token, "get_document", {
				documentId: created.documentId,
			})
		).status,
	).toBe(401)
})

function account(seed: number) {
	return Effect.gen(function* () {
		let signatures = yield* Signatures
		let identity = yield* signatures.account(
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
		return { api, subject: login.subject }
	})
}
function browserAccount(seed: number) {
	return run(
		Effect.gen(function* () {
			let signatures = yield* Signatures
			let identity = yield* signatures.account(
				Redacted.make(encode(new Uint8Array(32).fill(seed))),
			)
			let anonymous = yield* HttpApiClient.make(DocumentApi, {
				baseUrl: instance.server.url,
				transformClient: client =>
					HttpClient.mapRequest(
						client,
						HttpClientRequest.setHeader("Origin", instance.server.url.origin),
					),
			})
			let challenge = yield* anonymous.authentication.challenge({
				payload: { publicKey: identity.publicKey, purpose: "cookie" },
			})
			let signature = yield* identity.signAuthentication(challenge, {
				origin: instance.server.url.origin,
				purpose: "cookie",
			})
			let login = yield* Effect.promise(() =>
				fetch(new URL("/api/accounts/browser-session", instance.server.url), {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Origin: instance.server.url.origin,
					},
					body: JSON.stringify({
						id: challenge.id,
						publicKey: identity.publicKey,
						signature,
					}),
				}),
			)
			expect(login.status).toBe(200)
			let cookie = login.headers.get("set-cookie")?.split(";")[0] ?? ""
			let api = yield* HttpApiClient.make(DocumentApi, {
				baseUrl: instance.server.url,
				transformClient: client =>
					HttpClient.mapRequest(client, request =>
						HttpClientRequest.setHeaders(request, {
							Cookie: cookie,
							Origin: instance.server.url.origin,
						}),
					),
			})
			return { api, subject: identity.subject }
		}),
	)
}
function run<A, E>(
	work: Effect.Effect<A, E, HttpClient.HttpClient | Signatures | Crypto.Crypto>,
) {
	return Effect.runPromise(
		work.pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.provide(Signatures.layer),
			Effect.provide(webCryptoLayer),
		),
	)
}
function requestMcp(
	token: string,
	name: string,
	args: Record<string, unknown>,
) {
	return fetch(new URL("/mcp", instance.server.url), {
		method: "POST",
		headers: {
			Authorization: "Bearer " + token,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
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
	})
}
async function response(
	token: string,
	name: string,
	args: Record<string, unknown>,
) {
	let reply = await requestMcp(token, name, args)
	expect(reply.status).toBe(200)
	return object(object(await reply.json()).result)
}
async function call(
	token: string,
	name: string,
	args: Record<string, unknown>,
) {
	let result = await response(token, name, args)
	expect(result.isError).not.toBe(true)
	return object(result.structuredContent)
}
