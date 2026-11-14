import type { Database } from "@/app/features/documents/lib/library"
import { recordStartupTrace } from "@/app/lib/reload-diagnostics"

export { collectStartupDiagnostics }

function collectStartupDiagnostics(
	db: Pick<Database, "getSyncStatus" | "isLocalFirst" | "getAuthState">,
	ownerId: string,
) {
	let status = db.getSyncStatus()
	recordStartupTrace("jazz-v2-state", {
		accountKind:
			db.getAuthState().authMode === "local-first"
				? "device"
				: db.getAuthState().authMode,
		recoveryBackedUp:
			localStorage.getItem("alkalye-recovery-backed-up") === ownerId,
		localStore: db.isLocalFirst(),
		connection: status.link.state,
		offlineReason: status.link.state === "offline" ? status.link.reason : null,
		pendingUploads: status.pendingUploads,
		oldestPendingAt: status.oldestPendingAt,
		rejected: status.rejected,
		synced: status.synced,
		lastErrorKind: status.lastError?.kind ?? null,
	})
}
