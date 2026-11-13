import { schema as s } from "jazz-tools"
import { app } from "./schema"

export let permissions = s.definePermissions(app, ({ policy, session }) => {
	policy.documents.allowRead.where({ ownerId: session.user })
	policy.documents.allowInsert.where({ ownerId: session.user })
	policy.documents.allowUpdate.where({ ownerId: session.user })
	policy.documents.allowDelete.where({ ownerId: session.user })
})
