import { useEffect, useState } from "react"
import { Group } from "jazz-tools"
import { useAccount, useCoState } from "jazz-tools/react"
import { Users } from "lucide-react"
import { UserAccount } from "@/schema"
import { useIntl } from "@/shared/intl/setup"
import { TldrawAsset, WhiteboardPresenceFeed } from "../lib/schema"

export { WhiteboardPresence, countActiveWhiteboardSessions }

let HEARTBEAT_MS = 5_000
let STALE_AFTER_MS = 15_000

type PresenceSessions = Record<
	string,
	| {
			value: { open: boolean } | null
			madeAt: Date
	  }
	| undefined
>

function WhiteboardPresence({ assetId }: { assetId: string }) {
	let t = useIntl()
	let me = useAccount(UserAccount)
	let asset = useCoState(TldrawAsset, assetId, {
		resolve: { presence: true },
	})
	let [now, setNow] = useState(() => Date.now())
	let mySessionId = me.$isLoaded ? (me.$jazz.sessionID ?? null) : null
	let presence = asset?.$isLoaded ? asset.presence : undefined

	useEffect(() => {
		if (!mySessionId) return
		let activePresence: typeof presence
		let heartbeat: number | undefined
		let stopped = false

		function publishOpen() {
			if (!activePresence?.$isLoaded) return
			activePresence.$jazz.push({ open: true })
			setNow(Date.now())
		}

		function publishClosed() {
			if (activePresence?.$isLoaded) activePresence.$jazz.push({ open: false })
		}

		async function startHeartbeat() {
			let loaded = await TldrawAsset.load(assetId, {
				resolve: { presence: true },
			})
			if (!loaded.$isLoaded || stopped) return

			activePresence = loaded.presence
			if (!activePresence) {
				let owner = loaded.$jazz.owner
				if (!(owner instanceof Group)) return
				activePresence = WhiteboardPresenceFeed.create([], { owner })
				loaded.$jazz.set("presence", activePresence)
			}

			publishOpen()
			heartbeat = window.setInterval(publishOpen, HEARTBEAT_MS)
		}

		void startHeartbeat()
		window.addEventListener("pagehide", publishClosed)
		return () => {
			stopped = true
			if (heartbeat !== undefined) window.clearInterval(heartbeat)
			window.removeEventListener("pagehide", publishClosed)
			publishClosed()
		}
	}, [assetId, mySessionId])

	let count = countActiveWhiteboardSessions(
		presence?.$isLoaded ? presence.perSession : {},
		mySessionId,
		now,
	)
	if (count === 0) return null

	let label =
		count === 1
			? t("assets.whiteboardPresenceOne")
			: t("assets.whiteboardPresenceMany", { count: String(count) })

	return (
		<div
			role="status"
			aria-live="polite"
			className="bg-muted text-muted-foreground flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs whitespace-nowrap"
		>
			<Users aria-hidden="true" className="size-3.5" />
			<span>{label}</span>
		</div>
	)
}

function countActiveWhiteboardSessions(
	sessions: PresenceSessions,
	currentSessionId: string | null,
	now: number,
) {
	return Object.entries(sessions).filter(([sessionId, entry]) => {
		if (sessionId === currentSessionId || !entry?.value?.open) return false
		return now - entry.madeAt.getTime() <= STALE_AFTER_MS
	}).length
}
