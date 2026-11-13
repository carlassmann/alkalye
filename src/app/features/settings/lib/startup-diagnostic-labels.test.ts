import { expect, test } from "vitest"
import { collectStartupDiagnostics } from "./startup-diagnostic-labels"
import {
	clearReloadDiagnostics,
	readReloadDiagnostics,
} from "@/app/lib/reload-diagnostics"

test("reports offline local store, pending and rejected writes without recovery keys", () => {
	clearReloadDiagnostics()
	collectStartupDiagnostics(
		{
			isLocalFirst: () => true,
			getAuthState: () => ({ authMode: "local-first", session: null }),
			getSyncStatus: () => ({
				link: { state: "offline", reason: "network", retrying: true },
				pendingUploads: 3,
				rejected: 1,
				oldestPendingAt: 123,
				synced: false,
				lastError: null,
			}),
		},
		"account",
	)
	expect(readReloadDiagnostics().at(-1)).toMatchObject({
		event: "jazz-v2-state",
		details: {
			accountKind: "device",
			localStore: true,
			connection: "offline",
			offlineReason: "network",
			pendingUploads: 3,
			rejected: 1,
			oldestPendingAt: 123,
		},
	})
})
