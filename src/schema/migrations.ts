import { Group, co } from "jazz-tools"
import { Theme } from "@/app/features/themes/lib/schema"
import {
	Settings,
	DEFAULT_EDITOR_SETTINGS,
} from "@/app/features/settings/lib/schema"
import { fetchWelcomeContent } from "@/app/features/onboarding/lib/welcome-content"
import { Document } from "@/app/features/documents/lib/schema"
import { createDocumentMetadata } from "@/app/features/documents/lib/metadata"
import { Space } from "@/app/features/spaces/lib/schema"
import { recordStartupTrace } from "@/app/lib/reload-diagnostics"
import { UserRoot, UserProfile, type UserAccount } from "@/schema"

export { runAccountMigration, setMigrationFullDownloadTimeout }

let fullDownloadTimeoutMs = 10_000

function setMigrationFullDownloadTimeout(ms: number) {
	fullDownloadTimeoutMs = ms
}

// creationProps is defined only when the account is being created (including
// anonymous accounts on first open). On login and every subsequent load it is
// undefined, and the account may still be streaming in from sync. Creating or
// backfilling CoValues against that partial state would write a fresh empty
// pointer with a newer last-writer-wins timestamp and wipe the real data on
// every device. Guarantees: root, profile and the welcome document are only
// ever created on the creation path; the login path writes nothing unless both
// the account CoMap and the root CoMap are verified fully downloaded, and on
// any uncertainty (timeout) it skips the backfill entirely - every backfilled
// key is optional and harmless when absent.
async function runAccountMigration(
	account: co.loaded<typeof UserAccount>,
	creationProps?: { name: string },
) {
	let startedAt = performance.now()
	recordMigrationTrace("account-migration:start", {
		creation: Boolean(creationProps),
	})
	if (creationProps) {
		await initializeNewAccount(account, creationProps)
		recordMigrationTrace("account-migration:complete", {
			creation: true,
			outcome: "initialized",
			durationMs: millisecondsSince(startedAt),
		})
		return
	}
	let outcome = await backfillExistingAccount(account)
	recordMigrationTrace("account-migration:complete", {
		creation: false,
		outcome,
		durationMs: millisecondsSince(startedAt),
	})
}

async function initializeNewAccount(
	account: co.loaded<typeof UserAccount>,
	creationProps: { name: string },
) {
	if (!account.$jazz.has("root")) {
		account.$jazz.set(
			"root",
			UserRoot.create({
				documents: co.list(Document).create([]),
				migrationVersion: 1,
			}),
		)
	}

	if (!account.$jazz.has("profile")) {
		let profileGroup = Group.create()
		profileGroup.makePublic()
		account.$jazz.set(
			"profile",
			UserProfile.create({ name: creationProps.name }, profileGroup),
		)
	}

	let { root } = await account.$jazz.ensureLoaded({
		resolve: { root: { documents: true } },
	})

	if (root.documents.length === 0) {
		root.documents.$jazz.push(await createWelcomeDocument())
	}

	addMissingRootCollections(root)
}

async function backfillExistingAccount(
	account: co.loaded<typeof UserAccount>,
): Promise<string> {
	// Not a safety guard: the login path never writes to the account map, so
	// the has("root") early-return below already writes nothing on a streaming
	// account. Waiting makes has("root") authoritative, so the backfill runs on
	// a freshly synced login instead of being silently skipped.
	if (!(await isFullyDownloaded(account, "account"))) return "account-timeout"
	if (!account.$jazz.has("root")) return "root-missing"

	let rootLoadStartedAt = performance.now()
	recordMigrationTrace("account-migration-root-load:start")
	let loaded = await withTimeout(
		account.$jazz.ensureLoaded({ resolve: { root: true } }),
		fullDownloadTimeoutMs,
	)
	recordMigrationTrace("account-migration-root-load:complete", {
		loaded: loaded.ok && Boolean(loaded.value.root),
		durationMs: millisecondsSince(rootLoadStartedAt),
	})
	if (!loaded.ok || !loaded.value.root) return "root-load-timeout"

	// ensureLoaded already only emits completely downloaded CoValues in
	// jazz-tools 0.20.4 (see CoValueCoreSubscription.isReadyForEmit), but that
	// is an implementation detail - re-check before trusting missing keys.
	let root = loaded.value.root
	if (!(await isFullyDownloaded(root, "root"))) return "root-timeout"

	addMissingRootCollections(root)
	return "complete"
}

function addMissingRootCollections(root: co.loaded<typeof UserRoot>) {
	let owner = root.$jazz.owner

	if (!root.$jazz.has("settings")) {
		root.$jazz.set(
			"settings",
			Settings.create({ editor: DEFAULT_EDITOR_SETTINGS }, owner),
		)
	}
	if (!root.$jazz.has("spaces")) {
		root.$jazz.set("spaces", co.list(Space).create([], owner))
	}
	if (!root.$jazz.has("inactiveDocuments")) {
		root.$jazz.set("inactiveDocuments", co.list(Document).create([], owner))
	}
	if (!root.$jazz.has("themes")) {
		root.$jazz.set("themes", co.list(Theme).create([], owner))
	}
}

async function createWelcomeDocument() {
	let welcomeContent = await fetchWelcomeContent()
	let now = new Date()
	let group = Group.create()
	return Document.create(
		{
			version: 1,
			content: co.plainText().create(welcomeContent, group),
			...createDocumentMetadata(welcomeContent, now),
			createdAt: now,
			updatedAt: now,
		},
		group,
	)
}

type SyncableCoValue = {
	$jazz: {
		raw: {
			core: {
				isCompletelyDownloaded: () => boolean
				waitForFullStreaming: () => Promise<unknown>
			}
		}
	}
}

// A CoMap reports `isAvailable()` (what load/ensureLoaded's first emit waits for)
// while its content is still streaming in chunks, so a synchronous `has(key)`
// check can see a key as missing that actually exists. Only trust a "missing"
// key once the CoValue is fully downloaded; on uncertainty (timeout) skip the
// backfill entirely, since every backfilled key is optional and harmless when
// absent.
async function isFullyDownloaded(
	value: SyncableCoValue,
	phase: "account" | "root",
): Promise<boolean> {
	let startedAt = performance.now()
	let core = value.$jazz.raw.core
	let alreadyComplete = core.isCompletelyDownloaded()
	recordMigrationTrace(`account-migration-${phase}-download:start`, {
		alreadyComplete,
	})
	if (alreadyComplete) {
		recordMigrationTrace(`account-migration-${phase}-download:complete`, {
			completed: true,
			alreadyComplete: true,
			durationMs: millisecondsSince(startedAt),
		})
		return true
	}

	let streamed = await withTimeout(
		core.waitForFullStreaming(),
		fullDownloadTimeoutMs,
	)
	let completed = streamed.ok && core.isCompletelyDownloaded()
	recordMigrationTrace(`account-migration-${phase}-download:complete`, {
		completed,
		alreadyComplete: false,
		durationMs: millisecondsSince(startedAt),
	})
	return completed
}

async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
): Promise<{ ok: true; value: T } | { ok: false }> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise.then(value => ({ ok: true as const, value })),
			new Promise<{ ok: false }>(resolve => {
				timer = setTimeout(() => resolve({ ok: false }), ms)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

function recordMigrationTrace(
	event: string,
	details: Record<string, string | number | boolean> = {},
): void {
	if (typeof window === "undefined" || !window.__alkalyeStartupTraceId) return
	recordStartupTrace(event, details)
}

function millisecondsSince(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 10) / 10
}
