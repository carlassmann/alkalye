import { z } from "zod"
import type { AgentSecret } from "cojson"
import type { ID } from "jazz-tools"
import { UserAccount } from "@/schema"

export { agentCredentialsSchema }
export type { AgentCredentials }

let accountIdSchema = z.custom<ID<typeof UserAccount>>(
	value => typeof value === "string" && value.startsWith("co_z"),
)
let agentSecretSchema = z.custom<AgentSecret>(
	value =>
		typeof value === "string" &&
		value.startsWith("sealerSecret_z") &&
		value.includes("/signerSecret_z"),
)

let agentCredentialsSchema = z.object({
	accountId: accountIdSchema,
	accountSecret: agentSecretSchema,
})

type AgentCredentials = z.infer<typeof agentCredentialsSchema>
