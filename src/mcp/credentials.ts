import { z } from "zod"

export { connectionCredentialsSchema }
export type { ConnectionCredentials }

let connectionCredentialsSchema = z.object({
	accountId: z.uuid(),
	connectionId: z.uuid(),
	clientId: z.url(),
})
type ConnectionCredentials = z.infer<typeof connectionCredentialsSchema>
