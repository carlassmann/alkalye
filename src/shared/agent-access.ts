import * as Schema from "effect/Schema"
import { IdentifierSchema } from "./model"
import { AccessRoleSchema } from "./workspace"

export let AgentScopeSchema = Schema.Union([
	Schema.Literal("all"),
	Schema.NonEmptyArray(IdentifierSchema).check(Schema.isMaxLength(128)),
])
export let AgentAccessSchema = Schema.Struct({
	kind: Schema.Literal("account"),
	subject: IdentifierSchema,
	workspaces: AgentScopeSchema,
	ceiling: AccessRoleSchema,
})
export type AgentAccess = typeof AgentAccessSchema.Type
export class AgentConnectionRejected extends Schema.TaggedError<AgentConnectionRejected>()(
	"AgentConnectionRejected",
	{ message: Schema.String },
) {}

export function agentWorkspace(access: AgentAccess, workspace: string) {
	return access.workspaces === "all" || access.workspaces.includes(workspace)
}
