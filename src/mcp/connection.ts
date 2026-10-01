import { getMcpConfig } from "./config"
import { connectionCredentialsSchema } from "./credentials"
import { runWithUserAccount } from "./jazz"

export { validateConnection }

async function validateConnection(credential: string, clientId: string) {
	let config = getMcpConfig()
	let credentials = await config.tokens.open(
		"connection",
		credential,
		connectionCredentialsSchema,
	)
	if (credentials.clientId !== clientId) throw new Error("invalid_token")
	await runWithUserAccount(
		config.syncServer,
		credentials,
		async () => undefined,
	)
}
