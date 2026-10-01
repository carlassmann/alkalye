import { InvalidConnectionError, McpUnavailableError } from "./errors"
import { getMcpConfig } from "./config"
import { connectionCredentialsSchema } from "./credentials"
import { runWithUserAccount } from "./jazz"

export { validateConnection }

async function validateConnection(credential: string, clientId: string) {
	let config = getMcpConfig()
	let credentials
	try {
		credentials = await config.tokens.open(
			"connection",
			credential,
			connectionCredentialsSchema,
		)
	} catch {
		throw new InvalidConnectionError()
	}
	if (credentials.clientId !== clientId) throw new InvalidConnectionError()
	try {
		await runWithUserAccount(
			config.syncServer,
			credentials,
			async () => undefined,
		)
	} catch (error) {
		if (error instanceof InvalidConnectionError) throw error
		throw new McpUnavailableError(error)
	}
}
