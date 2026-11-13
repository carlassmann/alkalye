import { useEffect, useState } from "react"
import { app } from "@/jazz/schema"
import { useAll, useOne, useDb, useSession } from "jazz-tools/react"
import { Users } from "lucide-react"
import { useIntl } from "@/shared/intl/setup"

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

	let db = useDb()
	let accountId = useSession()?.user
	let { data: asset } = useOne(
		app.assets.where({ id: assetId }).select("documentId"),
	)
	let documentId = asset?.documentId
	let [deviceId] = useState(() => crypto.randomUUID())
	let { data: rows = [] } = useAll(
		app.presence.where({
			documentId: documentId ?? "00000000-0000-0000-0000-000000000000",
		}),
	)
	let [now, setNow] = useState(Date.now)
	useEffect(() => {
		if (!documentId || !accountId) return
		let id: string | undefined
		let stopped = false
		async function publish() {
			if (stopped) return
			setNow(Date.now())
			if (id)
				await db
					.update(app.presence, id, {
						updatedAt: new Date(),
						whiteboardOpen: true,
					})
					.wait({ tier: "local" })
			else {
				let write = db.insert(app.presence, {
					documentId: documentId!,
					accountId: accountId!,
					deviceId,
					whiteboardOpen: true,
					updatedAt: new Date(),
				})
				id = write.value.id
				await write.wait({ tier: "local" })
				if (stopped) void db.delete(app.presence, id)
			}
		}
		void publish().catch(console.error)
		let interval = window.setInterval(
			() => void publish().catch(console.error),
			HEARTBEAT_MS,
		)
		return () => {
			stopped = true
			clearInterval(interval)
			if (id) void db.delete(app.presence, id)
		}
	}, [db, documentId, accountId, deviceId])
	let count = rows.filter(
		row =>
			row.deviceId !== deviceId &&
			row.whiteboardOpen &&
			now - row.updatedAt.getTime() <= STALE_AFTER_MS,
	).length

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
