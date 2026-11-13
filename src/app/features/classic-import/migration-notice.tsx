import { ClassicImportPending } from "./migration-state"
import { app } from "@/jazz/schema"
import { messagesEn, messagesDe } from "@/shared/intl/messages"
import { useEffect, useState } from "react"
import { useJazzSession, useAll, useSession } from "jazz-tools/react"
import type { JazzClient } from "jazz-tools/client"
import { Button } from "@/app/components/ui/button"
import { useIntl, IntlProvider } from "@/shared/intl/setup"
import { readClassicCredentials, deviceSecretFromSeed } from "./identity"
import { markAccountBackedUp } from "@/app/features/auth/lib/backup-state"
import type { ImportProgress } from "./client"
export { ClassicMigration }

function ClassicMigration({ children }: { children: React.ReactNode }) {
	let ownerId = useSession()?.user ?? "00000000-0000-0000-0000-000000000000"
	let { data: settings = [] } = useAll(app.settings.where({ ownerId }))
	let locale = settings[0]?.language ?? "en"
	return (
		<IntlProvider
			locale={locale}
			messages={locale === "de" ? messagesDe : messagesEn}
		>
			<MigrationController>{children}</MigrationController>
		</IntlProvider>
	)
}
function MigrationController({ children }: { children: React.ReactNode }) {
	let { exportDeviceKey, restoreDeviceAccount, user } =
		useJazzSession<JazzClient>()
	let accountId = user?.accountId
	let t = useIntl()
	let [restoring, setRestoring] = useState(true)
	let [probing, setProbing] = useState(
		() =>
			localStorage.getItem("jazz-logged-in-secret") !== null ||
			sessionStorage.getItem("alkalye-classic-phrase-login") !== null ||
			localStorage.getItem(`alkalye-classic-user:${accountId}`) !== null,
	)
	let [progress, setProgress] = useState<ImportProgress>()
	let [error, setError] = useState("")
	let [attempt, setAttempt] = useState(0)
	let [dismissed, setDismissed] = useState(false)
	useEffect(() => {
		let cancelled = false
		async function restore() {
			try {
				let stored = readClassicCredentials()
				if (
					stored?.provider === "passphrase" &&
					deviceSecretFromSeed(new Uint8Array(stored.secretSeed)) ===
						exportDeviceKey() &&
					accountId
				)
					markAccountBackedUp(accountId)
				if (
					stored &&
					!localStorage.getItem(`alkalye-classic-restored:${stored.accountID}`)
				) {
					let secret = deviceSecretFromSeed(new Uint8Array(stored.secretSeed))
					if (exportDeviceKey() !== secret) await restoreDeviceAccount(secret)
					if (stored.provider === "passphrase" && accountId)
						markAccountBackedUp(accountId)
					localStorage.setItem(
						`alkalye-classic-restored:${stored.accountID}`,
						"true",
					)
				}
			} catch (error) {
				if (!cancelled)
					setError(
						error instanceof Error ? error.message : "Classic recovery failed",
					)
			}
			if (!cancelled) setRestoring(false)
		}
		void restore()
		return () => {
			cancelled = true
		}
	}, [exportDeviceKey, restoreDeviceAccount, accountId])
	useEffect(() => {
		if (restoring) return
		let controller = new AbortController()
		let key = exportDeviceKey()
		async function migrate() {
			try {
				let stored = readClassicCredentials()
				let matchesClassic =
					stored &&
					deviceSecretFromSeed(new Uint8Array(stored.secretSeed)) === key
				if (
					!matchesClassic &&
					!sessionStorage.getItem("alkalye-classic-phrase-login") &&
					!localStorage.getItem(`alkalye-classic-user:${accountId}`)
				)
					return
				let { runClassicImport } = await import("./client")
				await runClassicImport(
					key,
					state => {
						if (!controller.signal.aborted) setProgress(state)
					},
					controller.signal,
				)
			} catch (error) {
				// Fresh v2 accounts have no Classic account. Stored Classic credentials make failures actionable.
				if (!controller.signal.aborted && readClassicCredentials())
					setError(
						error instanceof Error ? error.message : "Classic import failed",
					)
			} finally {
				if (!controller.signal.aborted) {
					setProbing(false)
					sessionStorage.removeItem("alkalye-classic-phrase-login")
				}
			}
		}
		void migrate()
		return () => controller.abort()
	}, [exportDeviceKey, accountId, restoring, attempt])
	return (
		<ClassicImportPending.Provider value={restoring || probing}>
			{!dismissed && (progress || error) && (
				<div
					role="status"
					data-testid="classic-migration"
					className="bg-muted border-border fixed right-3 bottom-3 z-50 max-w-md rounded-md border p-3 text-sm shadow-md"
				>
					<p>{t("migration.disclosure")}</p>
					{progress && (
						<p>
							{progress.done
								? t("migration.complete")
								: `${t("migration.progress")} ${progress.completed}/${progress.total}`}
						</p>
					)}
					{(error || !!progress?.errors.length) && (
						<>
							<p role="alert">{error}</p>
							{progress?.errors.map(item => (
								<p key={item.id}>
									{item.id}: {item.message}
								</p>
							))}
							<Button
								size="sm"
								variant="outline"
								onClick={() => {
									setError("")
									setAttempt(attempt + 1)
								}}
							>
								{t("migration.retry")}
							</Button>
						</>
					)}
					{progress?.done && !progress.errors.length && (
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setDismissed(true)}
						>
							{t("migration.dismiss")}
						</Button>
					)}
				</div>
			)}
			{restoring ? <p role="status">{t("migration.opening")}</p> : children}
		</ClassicImportPending.Provider>
	)
}
