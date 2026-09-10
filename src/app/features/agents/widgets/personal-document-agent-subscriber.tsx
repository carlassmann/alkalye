import { useEffect } from "react"
import { useAccount } from "jazz-tools/react"
import { UserAccount } from "@/schema"
import { reconcilePersonalDocumentAccess } from "../lib/personal-document-access"

export { PersonalDocumentAgentSubscriber }

let subscriberQuery = {
	root: { agentConnections: { $each: true } },
} as const

let activeSubscriberQuery = {
	root: {
		documents: { $each: true },
		agentConnections: { $each: true },
	},
} as const

function PersonalDocumentAgentSubscriber() {
	let account = useAccount(UserAccount, { resolve: subscriberQuery })
	let hasActivePolicy =
		account.$isLoaded &&
		(account.root.agentConnections ?? []).some(
			connection => connection?.$isLoaded && connection.personalDocumentsRole,
		)
	return hasActivePolicy ? <ActivePersonalDocumentAgentSubscriber /> : null
}

function ActivePersonalDocumentAgentSubscriber() {
	let account = useAccount(UserAccount, { resolve: activeSubscriberQuery })
	let reconciliationKey = account.$isLoaded
		? [
				...account.root.documents.flatMap(document =>
					document?.$isLoaded ? [document.$jazz.id] : [],
				),
				...(account.root.agentConnections ?? []).flatMap(connection =>
					connection?.$isLoaded && connection.personalDocumentsRole
						? [
								`${connection.$jazz.id}:${connection.personalDocumentsRole}`,
							]
						: [],
				),
			].join("|")
		: ""

	useEffect(() => {
		if (!account.$isLoaded) return
		let loadedAccount = account
		let connections = (loadedAccount.root.agentConnections ?? []).flatMap(connection =>
			connection?.$isLoaded && connection.personalDocumentsRole
				? [connection]
				: [],
		)
		if (connections.length === 0) return

		let cancelled = false
		let retry: ReturnType<typeof setTimeout> | undefined
		async function reconcile() {
			try {
				for (let connection of connections) {
					await reconcilePersonalDocumentAccess(
						loadedAccount,
						connection,
						connection.personalDocumentsRole,
					)
				}
			} catch (error) {
				console.error("[agent-connections] personal access sync failed", error)
				if (!cancelled) retry = setTimeout(reconcile, 5_000)
			}
		}
		function retryOnline() {
			if (retry) clearTimeout(retry)
			void reconcile()
		}

		void reconcile()
		window.addEventListener("online", retryOnline)
		return () => {
			cancelled = true
			if (retry) clearTimeout(retry)
			window.removeEventListener("online", retryOnline)
		}
	}, [account, reconciliationKey])

	return null
}
