import { createJazzContextForNewAccount, MockSessionProvider } from "jazz-tools"
import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { createWebSocketPeer } from "cojson-transport-ws"
import { UserAccount, Document } from "../src/schema"
import { createTokenCodec } from "../src/mcp/token"
import { connectionCredentialsSchema } from "../src/mcp/credentials"
import { createPersonalDocument } from "../src/app/features/documents/lib/documents"
import { z } from "zod"

let baseUrl = process.argv[2] ?? process.env.ALKALYE_MCP_BASE_URL
if (!baseUrl) throw new Error("Missing MCP base URL")
baseUrl = new URL(baseUrl).origin
let syncServer = process.env.PUBLIC_JAZZ_SYNC_SERVER
if (!syncServer) throw new Error("Missing Jazz sync server")
let key = process.env.ALKALYE_MCP_TOKEN_KEY
if (!key) throw new Error("Missing token key")
let tokens = createTokenCodec(key)
let peer = createWebSocketPeer({
	websocket: new WebSocket(syncServer),
	id: "runtime-qa",
	role: "server",
})
let context = await createJazzContextForNewAccount({
	creationProps: { name: "MCP runtime QA" },
	peers: [peer],
	crypto: await WasmCrypto.create(),
	AccountSchema: UserAccount,
	sessionProvider: new MockSessionProvider(),
})
let document = await createPersonalDocument(
	context.account,
	"# Runtime user document\n\nHello",
)
await context.account.$jazz.waitForAllCoValuesSync({ timeout: 10000 })
let credentials = {
	accountId: context.account.$jazz.id,
	accountSecret: context.node.getCurrentAgent().agentSecret,
}
let verifier = "v".repeat(64)
let challenge = Buffer.from(
	await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
).toString("base64url")
let clientId = "https://custom.example/client.json"
async function approve(name: string) {
	let consent = await tokens.seal(
		"consent",
		{
			authorization: {
				client_id: clientId,
				redirect_uri: "https://custom.example/callback",
				response_type: "code",
				code_challenge: challenge,
				code_challenge_method: "S256",
				state: "runtime-qa",
				resource: `${baseUrl}/mcp`,
				scope: "alkalye",
			},
			client: { name, redirectHost: "custom.example" },
		},
		Date.now() + 60000,
	)
	let response = await fetch(`${baseUrl}/api/oauth-approve`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ decision: "approve", consent, credentials }),
	})
	let body = z.object({ redirectTo: z.url() }).parse(await response.json())
	if (!response.ok) throw new Error("Approval failed")
	let code = new URL(body.redirectTo).searchParams.get("code")
	if (!code) throw new Error("Missing code")
	let exchanged = await fetch(`${baseUrl}/oauth/token`, {
		method: "POST",
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			code_verifier: verifier,
			client_id: clientId,
			redirect_uri: "https://custom.example/callback",
			resource: `${baseUrl}/mcp`,
		}),
	})
	if (!exchanged.ok)
		throw new Error(
			`Token exchange ${exchanged.status}: ${await exchanged.text()}`,
		)
	return z
		.object({ access_token: z.string(), refresh_token: z.string() })
		.parse(await exchanged.json())
}
let first = await approve("Custom MCP")
let second = await approve("Other MCP connection")
console.log("PASS OAuth approval and exchange as user")
async function call(
	method: string,
	params: Record<string, unknown>,
	access = first.access_token,
) {
	let response = await fetch(`${baseUrl}/mcp`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${access}`,
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-method": method,
			...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
			"mcp-protocol-version": "2026-07-28",
			origin: "https://any-client.example",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method,
			params: {
				...params,
				_meta: {
					"io.modelcontextprotocol/protocolVersion": "2026-07-28",
					"io.modelcontextprotocol/clientInfo": {
						name: "custom",
						version: "1",
					},
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		}),
	})
	return { status: response.status, body: await response.json() }
}
let catalog = await call("tools/list", {})
if (catalog.status !== 200)
	throw new Error(`Catalog failed ${JSON.stringify(catalog)}`)
console.log("PASS arbitrary client tools/list")
let read = await call("tools/call", {
	name: "get_document",
	arguments: { documentId: document.$jazz.id },
})
let resultSchema = z.object({
	result: z.object({
		isError: z.boolean().optional(),
		structuredContent: z.object({ revision: z.string(), content: z.string() }),
	}),
})
let readResult = resultSchema.parse(read.body).result.structuredContent
if (!readResult.content.includes("Runtime user document"))
	throw new Error("Wrong user content")
let updated = await call("tools/call", {
	name: "update_document",
	arguments: {
		documentId: document.$jazz.id,
		expectedRevision: readResult.revision,
		content: "# Edited as user",
	},
})
if (JSON.stringify(updated.body).includes('"isError":true'))
	throw new Error(`Update failed ${JSON.stringify(updated.body)}`)
console.log("PASS read and update user's existing document")
let ownerPeer = createWebSocketPeer({
	websocket: new WebSocket(syncServer),
	id: "runtime-owner",
	role: "server",
})
let owner = await createJazzContextForNewAccount({
	creationProps: { name: "Other user" },
	peers: [ownerPeer],
	crypto: await WasmCrypto.create(),
	AccountSchema: UserAccount,
	sessionProvider: new MockSessionProvider(),
})
let writerDocument = await createPersonalDocument(
	owner.account,
	"Writer document",
)
let readerDocument = await createPersonalDocument(
	owner.account,
	"Reader document",
)
writerDocument.$jazz.owner.addMember(context.account, "writer")
readerDocument.$jazz.owner.addMember(context.account, "reader")
await owner.account.$jazz.waitForAllCoValuesSync({ timeout: 10000 })
let indexed = await context.account.$jazz.ensureLoaded({
	resolve: { root: { documents: true } },
})
indexed.root.documents.$jazz.push(writerDocument, readerDocument)
await context.account.$jazz.waitForAllCoValuesSync({ timeout: 10000 })
for (let [shared, writable] of [
	[writerDocument, true],
	[readerDocument, false],
] as const) {
	let sharedRead = await call("tools/call", {
		name: "get_document",
		arguments: { documentId: shared.$jazz.id },
	})
	let revision = resultSchema.parse(sharedRead.body).result.structuredContent
		.revision
	let sharedWrite = await call("tools/call", {
		name: "update_document",
		arguments: {
			documentId: shared.$jazz.id,
			content: "Changed via MCP",
			expectedRevision: revision,
		},
	})
	let failed =
		z
			.object({ result: z.object({ isError: z.boolean().optional() }) })
			.parse(sharedWrite.body).result.isError === true
	if (failed === writable) throw new Error("Shared user permission mismatch")
}
console.log("PASS non-admin writer editing and reader rejection")
owner.done()
let created = await call("tools/call", {
	name: "create_document",
	arguments: { content: "# Created as user" },
})
let createdId = z
	.object({
		result: z.object({
			structuredContent: z.object({ documentId: z.string() }),
		}),
	})
	.parse(created.body).result.structuredContent.documentId
let owned = await Document.load(createdId, { loadAs: context.account })
if (
	!owned.$isLoaded ||
	owned.$jazz.owner.getRoleOf(credentials.accountId) !== "admin"
)
	throw new Error("Wrong owner for personal creation")
console.log("PASS personal creation owned by user")
let account = await context.account.$jazz.ensureLoaded({
	resolve: { root: { mcpConnections: { $each: true }, documents: true } },
})
let connection = account.root.mcpConnections?.find(
	item => item.clientName === "Custom MCP",
)
if (!connection) throw new Error("Connection missing in user's root")
let wrapped = await tokens.open(
	"connection",
	connection.credential,
	connectionCredentialsSchema,
)
if (wrapped.accountId !== credentials.accountId)
	throw new Error("Separate account still used")
let disconnected = await fetch(`${baseUrl}/api/mcp-connections`, {
	method: "DELETE",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ credential: connection.credential }),
})
if (!disconnected.ok) throw new Error("Disconnect failed")
if ((await call("tools/list", {})).status !== 401)
	throw new Error("Revoked access token still accepted")
let refresh = await fetch(`${baseUrl}/oauth/token`, {
	method: "POST",
	body: new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: first.refresh_token,
		client_id: clientId,
		resource: `${baseUrl}/mcp`,
	}),
})
if (refresh.status !== 400)
	throw new Error("Revoked refresh token still accepted")
if ((await call("tools/list", {}, second.access_token)).status !== 200)
	throw new Error("Other connection was revoked")
if (
	account.root.revokedAt ||
	!account.root.documents.some(item => item.$jazz.id === document.$jazz.id)
)
	throw new Error("User data cleared by disconnect")
console.log(
	"PASS disconnect rejects access/refresh, preserves user and other client",
)
context.done()
process.exit(0)
