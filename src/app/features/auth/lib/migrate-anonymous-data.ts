import { Group, co } from "jazz-tools"
import { AgentConnection, UserAccount, Document } from "@/schema"
import { isWelcomeDoc } from "@/app/features/documents/lib/welcome-doc"

export { migrateAnonymousData }

async function migrateAnonymousData(
	anonymousAccount: co.loaded<typeof UserAccount>,
) {
	let { root: anonRoot } = await anonymousAccount.$jazz.ensureLoaded({
		resolve: {
			root: {
				documents: { $each: { content: true } },
				inactiveDocuments: { $each: { content: true } },
				agentConnections: { $each: true },
			},
		},
	})

	if (!anonRoot) return

	let me = await UserAccount.getMe().$jazz.ensureLoaded({
		resolve: {
			root: {
				documents: true,
				inactiveDocuments: true,
				agentConnections: { $each: true },
			},
		},
	})

	if (!me.root) return

	for (let connection of anonRoot.agentConnections ?? []) {
		if (!connection?.$isLoaded) continue
		let alreadyMigrated = me.root.agentConnections?.some(
			candidate =>
				candidate?.$isLoaded && candidate.provider === connection.provider,
		)
		if (alreadyMigrated) continue
		if (!me.root.agentConnections) {
			me.root.$jazz.set(
				"agentConnections",
				co.list(AgentConnection).create([], me.root.$jazz.owner),
			)
		}
		me.root.agentConnections!.$jazz.push(
			AgentConnection.create(
				{
					provider: connection.provider,
					accountId: connection.accountId,
					credential: connection.credential,
					personalDocumentsRole: connection.personalDocumentsRole,
					createdAt: connection.createdAt,
				},
				me.root.$jazz.owner,
			),
		)
	}

	for (let doc of Array.from(anonRoot.documents ?? [])) {
		if (!doc?.$isLoaded) continue
		// Skip unaltered welcome docs - new account already has one
		if (isWelcomeDoc(doc.content?.toString() ?? "")) continue
		let docGroup = doc.$jazz.owner
		if (docGroup instanceof Group) {
			docGroup.addMember(me, "admin")
		}
		me.root.documents.$jazz.push(doc)
	}

	for (let doc of Array.from(anonRoot.inactiveDocuments ?? [])) {
		if (!doc?.$isLoaded) continue
		// Skip unaltered welcome docs
		if (isWelcomeDoc(doc.content?.toString() ?? "")) continue
		let docGroup = doc.$jazz.owner
		if (docGroup instanceof Group) {
			docGroup.addMember(me, "admin")
		}
		if (!me.root.inactiveDocuments) {
			me.root.$jazz.set(
				"inactiveDocuments",
				co.list(Document).create([], me.root.$jazz.owner),
			)
		}
		me.root.inactiveDocuments!.$jazz.push(doc)
	}
}
