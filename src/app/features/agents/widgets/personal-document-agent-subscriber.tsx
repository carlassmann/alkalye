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
		inactiveDocuments: { $each: true },
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
					document?.$isLoaded
						? [
								`${document.$jazz.id}:${document.deletedAt?.toISOString() ?? "active"}`,
							]
						: [],
				),
				...(account.root.inactiveDocuments ?? []).flatMap(document =>
					document?.$isLoaded ? [`archived:${document.$jazz.id}`] : [],
				),
				...(account.root.agentConnections ?? []).flatMap(connection =>
					connection?.$isLoaded && connection.personalDocumentsRole
						? [`${connection.$jazz.id}:${connection.personalDocumentsRole}`]
						: [],
				),
			].join("|")
		: ""

	useEffect(() => {
		if (!account.$isLoaded) return
		let loadedAccount = account
		let connections = (loadedAccount.root.agentConnections ?? []).flatMap(
			connection =>
				connection?.$isLoaded && connection.personalDocumentsRole
					? [connection]
					: [],
		)
		if (connections.length === 0) return

		let cancelled = false
		let retry: ReturnType<typeof setTimeout> | undefined
		let attempt = 0
		async function reconcile() {
			let failures = 0
			for (let connection of connections) {
				try {
					await reconcilePersonalDocumentAccess(
						loadedAccount,
						connection,
						connection.personalDocumentsRole,
					)
				} catch (error) {
					failures++
					console.error(
						"[agent-connections] personal access sync failed",
						error,
					)
				}
			}
			if (failures === 0 || cancelled || attempt >= 3) return
			let delay = 2_000 * 2 ** attempt
			attempt++
			retry = setTimeout(reconcile, delay)
		}
		function retryOnline() {
			attempt = 0
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
