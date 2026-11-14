// @vitest-environment node
import { Buffer } from "node:buffer"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { createContext } from "astro/middleware"
import {
	acceptDeviceAccounts,
	createJazz,
	memory,
	type Jazz,
} from "jazz-tools/backend"
import { mintLocalFirstTokenInJs } from "jazz-tools/thin"
import { app } from "./schema"
import { permissions } from "./permissions"
import { createTokenCodec } from "@/mcp/token"
import { createEphemeralReplayStore } from "@/mcp/replay-store"

let state: { jazz?: Jazz } = vi.hoisted(() => ({}))
vi.mock("@/jazz/server", () => ({
	get jazz() {
		return state.jazz
	},
}))
vi.mock("@/mcp/config", () => ({
	getMcpConfig() {
		return { baseUrl: new URL(origin), tokens, replayStore }
	},
}))
let origin = "https://alkalye.test"
let tokens = createTokenCodec("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
let replayStore = createEphemeralReplayStore()
let key =
	"jazz-auth-v1:" +
	Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
let consent: string
beforeAll(async () => {
	state.jazz = await createJazz({
		app,
		permissions,
		store: memory(),
		authenticate: acceptDeviceAccounts,
		publicUrl: origin + "/jazz",
	}).ready()
	consent = await tokens.seal("consent", {
		authorization: {
			client_id: "https://client.test/client.json",
			redirect_uri: "https://client.test/callback",
			response_type: "code",
			code_challenge: "a".repeat(43),
			code_challenge_method: "S256",
			state: "qa",
			resource: origin + "/mcp",
			scope: "alkalye",
		},
		client: { name: "QA", redirectHost: "client.test" },
	})
})
afterAll(async () => {
	await state.jazz?.close()
})

function proof(audience = origin + "/jazz") {
	return mintLocalFirstTokenInJs(key, audience)
}
async function approve(token: string, browserOrigin = origin) {
	let { POST } = await import("@/pages/api/oauth-approve")
	let request = new Request(origin + "/api/oauth-approve", {
		method: "POST",
		headers: { authorization: "Bearer " + token, origin: browserOrigin },
		body: JSON.stringify({ decision: "approve", consent }),
	})
	return POST(createContext({ request, defaultLocale: "en", locals: {} }))
}
async function share(token: string, browserOrigin = origin) {
	let { POST } = await import("@/pages/api/sharing/[action]")
	let request = new Request(origin + "/api/sharing/create-invite", {
		method: "POST",
		headers: { authorization: "Bearer " + token, origin: browserOrigin },
		body: JSON.stringify({ documentId }),
	})
	return POST(
		createContext({
			request,
			params: { action: "create-invite" },
			defaultLocale: "en",
			locals: {},
		}),
	)
}
let documentId: string
test("approval and sharing use the same admitted device account", async () => {
	let token = proof()
	let db = await state.jazz!.forReqUser(
		new Request(origin + "/api/cli", {
			headers: { authorization: "Bearer " + token },
		}),
	)
	let accountId = db.getAuthState().session!.user!
	let doc = await state
		.jazz!.db.insert(app.documents, {
			ownerId: accountId,
			title: "QA",
			content: "# QA",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	documentId = doc.id
	expect((await approve(token)).status).toBe(200)
	expect((await share(token)).status).toBe(200)
	let [connection] = await state.jazz!.db.all(app.mcpConnections)
	let [invite] = await state.jazz!.db.all(app.invites)
	expect(connection?.ownerId).toBe(accountId)
	expect(invite?.ownerId).toBe(accountId)
})

test.each(["forged", "expired", "foreign audience", "foreign origin"])(
	"approval and sharing reject %s proofs before privileged writes",
	async kind => {
		let token = proof()
		if (kind === "forged") token += "tampered"
		if (kind === "foreign audience") token = proof("https://attacker.test/jazz")
		if (kind === "expired") {
			let clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 7200_000)
			try {
				token = proof()
			} finally {
				clock.mockRestore()
			}
		}
		let browserOrigin =
			kind === "foreign origin" ? "https://attacker.test" : origin
		expect((await approve(token, browserOrigin)).status).toBe(400)
		expect((await share(token, browserOrigin)).status).toBe(401)
		expect(await state.jazz!.db.all(app.mcpConnections)).toHaveLength(1)
		expect(await state.jazz!.db.all(app.invites)).toHaveLength(1)
	},
)
