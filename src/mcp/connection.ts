import { InvalidConnectionError, McpUnavailableError } from "./errors"
import { getMcpConfig } from "./config"
import { validateCredentials } from "./jazz"

export { validateConnection }

async function validateConnection(credential: string, clientId: string) {
	try {
		await validateCredentials(credential, getMcpConfig().tokens, clientId)
	} catch (error) {
		if (error instanceof InvalidConnectionError) throw error
		throw new McpUnavailableError(error)
	}
}
