import { Buffer } from "node:buffer"
import { readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { z } from "zod"
import { mintLocalFirstTokenInJs } from "jazz-tools/thin"
import { createTokenCodec } from "../src/mcp/token"

let origin = new URL(process.argv[2] ?? process.env.ALKALYE_MCP_BASE_URL ?? "")
	.origin
let key = process.env.ALKALYE_MCP_TOKEN_KEY
if (!key) throw new Error("Missing ALKALYE_MCP_TOKEN_KEY")
let secret = process.env.ALKALYE_QA_DEVICE_KEY_FILE
	? (await readFile(process.env.ALKALYE_QA_DEVICE_KEY_FILE, "utf8")).trim()
	: `jazz-auth-v1:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`
let tokens = createTokenCodec(key)
let clientId = "https://custom.example/client.json"
let verifier = "v".repeat(64)
let challenge = createHash("sha256").update(verifier).digest("base64url")
let resource = `${origin}/mcp`
function proof(device = secret) {
	return {
		authorization: `Bearer ${mintLocalFirstTokenInJs(device, `${origin}/jazz`)}`,
	}
}
async function cli(
	command: string,
	args: Record<string, unknown> = {},
	device = secret,
) {
	let response = await fetch(`${origin}/api/cli`, {
		method: "POST",
		headers: { "content-type": "application/json", ...proof(device) },
		body: JSON.stringify({ command, args }),
	})
	if (!response.ok)
		throw new Error(
			`CLI ${command}: ${response.status} ${await response.text()}`,
		)
	return z.object({ data: z.unknown() }).parse(await response.json()).data
}
async function approve(name: string, device = secret) {
	let consent = await tokens.seal(
		"consent",
		{
			authorization: {
				client_id: clientId,
				redirect_uri: `${origin}/app/settings?qa_callback=1`,
				response_type: "code",
				code_challenge: challenge,
				code_challenge_method: "S256",
				state: "runtime-qa",
				resource,
				scope: "alkalye",
			},
			client: { name, redirectHost: new URL(origin).host },
		},
		Date.now() + 60000,
	)
	let approved = await fetch(`${origin}/api/oauth-approve`, {
		method: "POST",
		headers: { "content-type": "application/json", ...proof(device) },
		body: JSON.stringify({ decision: "approve", consent }),
	})
	if (!approved.ok)
		throw new Error(`Approval ${approved.status}: ${await approved.text()}`)
	let redirect = z.object({ redirectTo: z.url() }).parse(await approved.json())
	let code = new URL(redirect.redirectTo).searchParams.get("code")
	if (!code) throw new Error("Missing code")
	let response = await fetch(`${origin}/oauth/token`, {
		method: "POST",
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			code_verifier: verifier,
			client_id: clientId,
			redirect_uri: `${origin}/app/settings?qa_callback=1`,
			resource,
		}),
	})
	if (!response.ok)
		throw new Error(
			`Token exchange ${response.status}: ${await response.text()}`,
		)
	return z
		.object({ access_token: z.string(), refresh_token: z.string() })
		.parse(await response.json())
}
async function call(
	name: string,
	args: Record<string, unknown> = {},
	access = first.access_token,
) {
	let response = await fetch(resource, {
		method: "POST",
		headers: {
			authorization: `Bearer ${access}`,
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-method": "tools/call",
			"mcp-name": name,
			"mcp-protocol-version": "2026-07-28",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "tools/call",
			params: {
				name,
				arguments: args,
				_meta: {
					"io.modelcontextprotocol/protocolVersion": "2026-07-28",
					"io.modelcontextprotocol/clientInfo": {
						name: "runtime-qa",
						version: "1",
					},
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		}),
	})
	if (response.status === 401)
		return { isError: true, structuredContent: undefined }
	if (!response.ok)
		throw new Error(`MCP ${name}: ${response.status} ${await response.text()}`)
	return z
		.object({
			result: z.object({
				isError: z.boolean().optional(),
				structuredContent: z.unknown().optional(),
			}),
		})
		.parse(await response.json()).result
}
function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

await cli("auth.login", { name: "MCP browser QA" })
let first = await approve("Runtime MCP QA")
let second = await approve("Other MCP QA")
console.log("PASS OAuth approval without device secrets, PKCE exchange")
let created = await call("create_document", {
	content: "# MCP runtime QA\n\nQuoted text",
})
assert(!created.isError, "Create failed")
let doc = z
	.object({ documentId: z.string(), revision: z.string() })
	.parse(created.structuredContent)
assert(!(await call("list_documents")).isError, "List failed")
assert(
	!(await call("get_document", { documentId: doc.documentId })).isError,
	"Read failed",
)
assert(
	(
		await call("update_document", {
			documentId: doc.documentId,
			content: "stale",
			expectedRevision: "stale",
		})
	).isError,
	"Revision accepted stale write",
)
let update = await call("update_document", {
	documentId: doc.documentId,
	content: "# MCP runtime QA\n\nQuoted text edited live",
	expectedRevision: doc.revision,
})
assert(!update.isError, "Update failed")
let next = z.object({ revision: z.string() }).parse(update.structuredContent)
assert(
	!(
		await call("rename_document", {
			documentId: doc.documentId,
			title: "MCP live browser update",
			expectedRevision: next.revision,
		})
	).isError,
	"Rename failed",
)
let comment = await call("add_comment", {
	documentId: doc.documentId,
	quote: "Quoted text",
	body: "QA comment",
})
assert(!comment.isError, "Comment failed")
let { commentId } = z
	.object({ commentId: z.string() })
	.parse(comment.structuredContent)
for (let name of ["reply_to_comment", "set_comment_resolved", "list_comments"])
	assert(
		!(
			await call(name, {
				documentId: doc.documentId,
				commentId,
				body: "QA reply",
				resolved: true,
			})
		).isError,
		`${name} failed`,
	)
console.log(
	"PASS personal create/list/read/update/rename, revision conflict, anchored comments/reply/resolve",
)
let bob = `jazz-auth-v1:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`
await cli("auth.signup", { name: "Other QA user" }, bob)
let privateDoc = z
	.object({ documentId: z.string() })
	.parse(
		await cli(
			"doc.create",
			{ content: "# Other user's private document" },
			bob,
		),
	)
assert(
	(await call("get_document", { documentId: privateDoc.documentId })).isError,
	"Other user's document leaked",
)
let invite = z
	.object({ link: z.string() })
	.parse(
		await cli(
			"doc.share.create",
			{ docId: privateDoc.documentId, role: "writer" },
			bob,
		),
	)
await cli("invite.accept", { link: invite.link })
let shared = z
	.object({ revision: z.string() })
	.parse(
		(await call("get_document", { documentId: privateDoc.documentId }))
			.structuredContent,
	)
assert(
	!(
		await call("update_document", {
			documentId: privateDoc.documentId,
			content: "# Shared writer update",
			expectedRevision: shared.revision,
		})
	).isError,
	"Shared writer rejected",
)
assert(
	(await call("archive_document", { documentId: privateDoc.documentId }))
		.isError,
	"Writer archived document",
)
console.log(
	"PASS outsider isolation, shared non-admin writer edit, archive rejected",
)
let { readAccessToken } = await import("../src/mcp/oauth")
let { connectionCredentialsSchema } = await import("../src/mcp/credentials")
let access = await readAccessToken(tokens, first.access_token)
let credentials = await tokens.open(
	"connection",
	access.credential,
	connectionCredentialsSchema,
)
let revoke = await fetch(`${origin}/api/mcp-connections`, {
	method: "DELETE",
	headers: { "content-type": "application/json", ...proof() },
	body: JSON.stringify({ connectionId: credentials.connectionId }),
})
assert(revoke.ok, "Revocation failed")
assert(
	(await call("get_document", { documentId: doc.documentId })).isError,
	"Revoked call passed",
)
assert(
	!(
		await call(
			"get_document",
			{ documentId: doc.documentId },
			second.access_token,
		)
	).isError,
	"Other connection revoked",
)
let refresh = await fetch(`${origin}/oauth/token`, {
	method: "POST",
	body: new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: first.refresh_token,
		client_id: clientId,
		resource,
	}),
})
assert(refresh.status === 400, "Revoked refresh passed")
console.log(
	"PASS per-call revocation, refresh refusal, other connection survives",
)
console.log(`Browser document: ${origin}/app/doc/${doc.documentId}`)

if (process.env.ALKALYE_QA_STATE_FILE)
	await writeFile(
		process.env.ALKALYE_QA_STATE_FILE,
		JSON.stringify({ access: second.access_token, documentId: doc.documentId }),
		{ mode: 0o600 },
	)
