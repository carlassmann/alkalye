import { co } from "jazz-tools"
import { AgentConnection, Document, UserAccount } from "@/schema"
import { updateAgentGrants } from "./agent-api"

export { personalDocumentAccessQuery, reconcilePersonalDocumentAccess }
export type { AgentDocumentRole }

type AgentDocumentRole = "reader" | "writer"
let personalDocumentAccessQuery = {
	root: {
		documents: { $each: true },
		inactiveDocuments: { $each: true },
	},
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

	let activeDocuments = Array.from(account.root.documents.values())
	let inactiveDocuments = Array.from(
		account.root.inactiveDocuments?.values() ?? [],
	)
	let membershipChanges: MembershipChange[] = []
	try {
		for (let document of [...activeDocuments, ...inactiveDocuments]) {
			if (!document?.$isLoaded) continue
			let owner = document.$jazz.owner
			let currentRole = owner.getRoleOf(connection.accountId)
			let isActive = activeDocuments.includes(document) && !document.deletedAt
			let desiredRole = isActive ? role : undefined
			if (desiredRole && currentRole === desiredRole) continue
			if (
				!desiredRole &&
				currentRole !== "reader" &&
				currentRole !== "writer"
			) {
				continue
			}
			if (
				currentRole !== undefined &&
				currentRole !== "reader" &&
				currentRole !== "writer"
			) {
				continue
			}

			if (desiredRole) owner.addMember(agent, desiredRole)
			else owner.removeMember(agent)
			membershipChanges.push({ document, currentRole, desiredRole })
		}
		await updateAgentGrants(
			connection.credential,
			membershipChanges.map(change => ({
				action: change.desiredRole ? "add" : "remove",
				resource: { kind: "document", id: change.document.$jazz.id },
			})),
		)
	} catch (error) {
		for (let change of membershipChanges) {
			let owner = change.document.$jazz.owner
			if (change.currentRole === "reader" || change.currentRole === "writer") {
				owner.addMember(agent, change.currentRole)
			} else owner.removeMember(agent)
		}
		throw error
	}
}

interface MembershipChange {
	document: co.loaded<typeof Document>
	currentRole: string | undefined
	desiredRole: AgentDocumentRole | undefined
}
