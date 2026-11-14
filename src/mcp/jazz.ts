import { createHash } from "node:crypto"
import { app } from "@/jazz/schema"
import { jazz } from "@/jazz/server"
import { InvalidConnectionError } from "./errors"
import {
	connectionCredentialsSchema,
	type ConnectionCredentials,
} from "./credentials"
import type { TokenCodec } from "./token"

export {
	createUserConnection,
	runWithUserAccount,
	revokeUserConnection,
	validateCredentials,
}

async function createUserConnection(
	request: Request,
	client: { id: string; name: string },
	tokens: TokenCodec,
) {
	let db = await jazz.forReqUser(request)
	let accountId = db.getAuthState().session?.user
	if (!accountId) throw new InvalidConnectionError()
	let connectionId = crypto.randomUUID()
	let credential = await tokens.seal("connection", {
		accountId,
		connectionId,
		clientId: client.id,
	})
	await jazz.db
		.insert(
			app.mcpConnections,
			{
				ownerId: accountId,
				clientId: client.id,
				clientName: client.name,
				credential: credentialHash(credential),
				createdAt: new Date(),
			},
			{ id: connectionId },
		)
		.wait({ tier: "global" })
	return credential
}

async function validateCredentials(
	credential: string,
	tokens: TokenCodec,
	clientId?: string,
) {
	let credentials: ConnectionCredentials
	try {
		credentials = await tokens.open(
			"connection",
			credential,
			connectionCredentialsSchema,
		)
	} catch {
		throw new InvalidConnectionError()
	}
	if (clientId && credentials.clientId !== clientId)
		throw new InvalidConnectionError()
	let connection = await jazz.db.one(
		app.mcpConnections.where({ id: credentials.connectionId }),
	)
	if (
		!connection ||
		connection.revokedAt ||
		connection.ownerId !== credentials.accountId ||
		connection.clientId !== credentials.clientId ||
		connection.credential !== credentialHash(credential)
	)
		throw new InvalidConnectionError()
	return credentials
}

async function runWithUserAccount<Result>(
	credential: string,
	tokens: TokenCodec,
	operation: (
		db: Awaited<ReturnType<typeof jazz.forUser>>,
		accountId: string,
	) => Promise<Result>,
) {
	let credentials = await validateCredentials(credential, tokens)
	let db = await jazz.forUser(credentials.accountId)
	return operation(db, credentials.accountId)
}

async function revokeUserConnection(request: Request, connectionId: string) {
	let db = await jazz.forReqUser(request)
	let connection = await db.one(app.mcpConnections.where({ id: connectionId }))
	if (!connection) throw new InvalidConnectionError()
	await jazz.db
		.update(app.mcpConnections, connection.id, { revokedAt: new Date() })
		.wait({ tier: "global" })
}

function credentialHash(credential: string) {
	return createHash("sha256").update(credential).digest("hex")
}
