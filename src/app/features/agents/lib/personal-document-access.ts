import { co } from "jazz-tools"
import { AgentConnection, UserAccount } from "@/schema"

export { personalDocumentAccessQuery, reconcilePersonalDocumentAccess }
export type { AgentDocumentRole }

type AgentDocumentRole = "reader" | "writer"
let personalDocumentAccessQuery = {
	root: { documents: { $each: true } },
} as const
type PersonalDocumentAccount = co.loaded<
	typeof UserAccount,
	typeof personalDocumentAccessQuery
>

async function reconcilePersonalDocumentAccess(
	account: PersonalDocumentAccount,
	connection: co.loaded<typeof AgentConnection>,
	role: AgentDocumentRole | undefined,
) {
	let agent = await UserAccount.load(connection.accountId)
	if (!agent.$isLoaded) throw new Error("Agent account is unavailable")

	for (let document of account.root.documents.values()) {
		if (!document?.$isLoaded) continue
		let owner = document.$jazz.owner
		let currentRole = owner.getRoleOf(connection.accountId)
		if (role && currentRole === role) continue
		if (!role && currentRole !== "reader" && currentRole !== "writer") continue
		if (
			currentRole !== undefined &&
			currentRole !== "reader" &&
			currentRole !== "writer"
		) {
			continue
		}

		if (role) owner.addMember(agent, role)
		else owner.removeMember(agent)
		try {
			await updateAgentGrant(connection.credential, document.$jazz.id, role)
		} catch (error) {
			if (currentRole === "reader" || currentRole === "writer") {
				owner.addMember(agent, currentRole)
			} else {
				owner.removeMember(agent)
			}
			throw error
		}
	}
}

async function updateAgentGrant(
	credential: string,
	documentId: string,
	role: AgentDocumentRole | undefined,
) {
	let response = await fetch("/api/agent-grants", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			credential,
			action: role ? "add" : "remove",
			resource: { kind: "document", id: documentId },
		}),
	})
	if (!response.ok) throw new Error("Could not update personal document access")
}
