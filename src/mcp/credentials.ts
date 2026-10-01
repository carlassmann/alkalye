import { z } from "zod"
import type { AgentSecret } from "cojson"
import type { ID } from "jazz-tools"
import { UserAccount } from "@/schema"

export { connectionCredentialsSchema, accountCredentialsSchema }
export type { ConnectionCredentials }

let accountIdSchema = z.custom<ID<typeof UserAccount>>(
	value => typeof value === "string" && value.startsWith("co_z"),
)
let agentSecretSchema = z.custom<AgentSecret>(
	value =>
		typeof value === "string" &&
		value.startsWith("sealerSecret_z") &&
		value.includes("/signerSecret_z"),
)

let accountCredentialsSchema = z.object({
	accountId: accountIdSchema,
	accountSecret: agentSecretSchema,
})

let connectionCredentialsSchema = accountCredentialsSchema.extend({
	connectionId: z.string().startsWith("co_z"),
	clientId: z.url(),
})

type ConnectionCredentials = z.infer<typeof connectionCredentialsSchema>
