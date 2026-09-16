import { createContext, useContext, useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { Share, Upload } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/app/components/ui/dialog"
import {
	isAndroid,
	isIOS,
	isMobileDevice,
	getPWAInstalledSnapshot,
	useIsPWAInstalled,
} from "@/app/lib/platform"
import { useIntl, T } from "@/shared/intl/setup"
import { countNotes, type ChangelogEntry } from "@/shared/changelog"
import {
	markReleaseNotesSeen,
	fetchPendingReleaseNotes,
} from "@/app/lib/release-notes"

export { PWAContext, usePWA, usePWAProvider }
export { PWAInstallHint, PWAInstallDialog }
export type { PWAContextValue }

type PWAContextValue = {
	needRefresh: boolean
	offlineReady: boolean
	updateServiceWorker: () => Promise<void>
	checkForUpdates: () => Promise<void>
}

let PWAContext = createContext<PWAContextValue | null>(null)

function usePWA(): PWAContextValue {
	let context = useContext(PWAContext)
	if (!context) {
		return {
			needRefresh: false,
			offlineReady: false,
			updateServiceWorker: async () => {},
			checkForUpdates: async () => {},
		}
	}
	return context
}

function usePWAProvider(): PWAContextValue {
	let [needRefresh, setNeedRefresh] = useState(false)
	let [offlineReady, setOfflineReady] = useState(false)
	let updateRef = useRef<(reload?: boolean) => Promise<void>>(() =>
		Promise.resolve(),
	)
	let t = useIntl()
	let labels = {
		updateAvailable: t("pwa.updateAvailable"),
		updateDescription: t("pwa.updateDescription"),
		updateAction: t("pwa.updateAction"),
		whatsNew: t("pwa.whatsNew"),
		offlineReady: t("pwa.offlineReady"),
		offlineDescription: t("pwa.offlineDescription"),
		moreLabel: (count: number) => t("pwa.updateMore", { count }),
	}
	let labelsRef = useRef(labels)
	labelsRef.current = labels

	useEffect(markReleaseNotesSeen, [])

	// virtual:pwa-register is a Vite virtual module. Dynamic-importing it
	// inside useEffect keeps this file safe to load in non-Vite contexts
	// (CLI, Node tests). Outside a browser the effect never runs.
	useEffect(() => {
		let cancelled = false
		import("virtual:pwa-register")
			.then(({ registerSW }) => {
				if (cancelled) return
				let updateSW = registerSW({
					onRegisteredSW(swUrl, registration) {
						console.log("[PWA] Service worker registered:", swUrl)
						if (registration) {
							;(
								window as Window & {
									__swRegistration?: ServiceWorkerRegistration
								}
							).__swRegistration = registration
						}
					},
					onRegisterError(error) {
						console.error("[PWA] Service worker registration error:", error)
					},
					onNeedRefresh() {
						setNeedRefresh(true)
						let show = (notes: ChangelogEntry[]) =>
							showUpdateToast({
								notes,
								labels: labelsRef.current,
								onReload: () => updateSW(true),
								onDismiss: () => setNeedRefresh(false),
							})
						fetchPendingReleaseNotes().then(show, () => show([]))
					},
					onOfflineReady() {
						let labels = labelsRef.current
						setOfflineReady(true)
						if (isMobileDevice() && getPWAInstalledSnapshot()) {
							toast(labels.offlineReady, {
								description: labels.offlineDescription,
								duration: 4000,
							})
						}
						setTimeout(() => setOfflineReady(false), 4000)
					},
				})
				updateRef.current = updateSW
			})
			.catch(err => {
				console.warn("[PWA] registration unavailable in this environment", err)
			})
		return () => {
			cancelled = true
		}
	}, [])

	async function checkForUpdates() {
		let registration = (
			window as Window & { __swRegistration?: ServiceWorkerRegistration }
		).__swRegistration
		if (registration) {
			await registration.update()
		}
	}

	return {
		needRefresh,
		offlineReady,
		updateServiceWorker: () => updateRef.current(true),
		checkForUpdates,
	}
}

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let INSTALL_HINT_DISMISSED_KEY = "pwa-install-hint-dismissed"

// Components

function PWAInstallHint() {
	let isPWAInstalled = useIsPWAInstalled()
	let { dismissed, setDismissed } = usePWAInstallHintDismissed()
	let [dialogOpen, setDialogOpen] = useState(false)
	let [toastShown, setToastShown] = useState(false)

	let shouldShowHint = isMobileDevice() && !isPWAInstalled && !dismissed

	useEffect(() => {
		if (!shouldShowHint || toastShown) return

		let timeout = setTimeout(() => {
			setToastShown(true)
			toast(
				<div className="flex flex-col gap-3">
					<div>
						<div className="font-medium">
							<T k="pwa.installTitle" />
						</div>
						<div className="text-muted-foreground text-sm">
							<T k="pwa.installHint" />
						</div>
					</div>
					<div className="flex flex-row-reverse justify-start gap-2">
						<Button
							size="sm"
							onClick={() => {
								toast.dismiss()
								setDialogOpen(true)
							}}
						>
							<T k="pwa.showMeHow" />
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								toast.dismiss()
								setDismissed(true)
							}}
						>
							<T k="pwa.maybeLater" />
						</Button>
					</div>
				</div>,
				{ duration: Infinity },
			)
		}, 2000)

		return () => clearTimeout(timeout)
	}, [shouldShowHint, toastShown, setDismissed])

	return (
		<PWAInstallDialog
			open={dialogOpen}
			onOpenChange={setDialogOpen}
			onInstallComplete={() => setDialogOpen(false)}
		/>
	)
}

interface PWAInstallDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onInstallComplete?: () => void
}

function PWAInstallDialog({
	open,
	onOpenChange,
	onInstallComplete,
}: PWAInstallDialogProps) {
	let { canInstall, promptInstall } = usePWAInstallPrompt()
	let t = useIntl()

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<T k="pwa.installTitle" />
					</DialogTitle>
					<DialogDescription>
						{isMobileDevice()
							? t("pwa.installMobile")
							: t("pwa.installDesktop")}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					{isAndroid() && canInstall && (
						<AndroidChromeInstructions
							onInstall={promptInstall}
							onInstallComplete={onInstallComplete}
						/>
					)}
					{isAndroid() && !canInstall && <AndroidManualInstructions />}
					{isIOS() && <IOSInstructions />}
					{!isAndroid() && !isIOS() && isMobileDevice() && (
						<GenericInstructions />
					)}
					{!isMobileDevice() && (
						<DesktopInstructions
							canInstall={canInstall}
							onInstall={promptInstall}
							onInstallComplete={onInstallComplete}
						/>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}

// Instruction components

function AndroidChromeInstructions({
	onInstall,
	onInstallComplete,
}: {
	onInstall: () => Promise<"accepted" | "dismissed" | null>
	onInstallComplete?: () => void
}) {
	async function handleInstall() {
		let result = await onInstall()
		if (result === "accepted") onInstallComplete?.()
	}

	return (
		<div className="space-y-3">
			<p className="text-muted-foreground text-xs">
				<T k="pwa.directInstallSupport" />
			</p>
			<Button onClick={handleInstall} className="w-full">
				<T k="pwa.installApp" />
			</Button>
		</div>
	)
}

function AndroidManualInstructions() {
	return (
		<div className="space-y-3">
			<p className="text-muted-foreground text-xs">
				<T k="pwa.androidManualTitle" />
			</p>
			<ol className="text-muted-foreground list-decimal space-y-2 pl-4 text-xs">
				<li>
					<T k="pwa.androidMenuButton" /> <Share className="inline size-3" />{" "}
					<T k="pwa.androidInBrowser" />
				</li>
				<li>
					<T k="pwa.androidSelectOption" />
				</li>
				<li>
					<T k="pwa.androidConfirm" />
				</li>
			</ol>
		</div>
	)
}

function IOSInstructions() {
	return (
		<div className="space-y-3">
			<p className="text-muted-foreground text-xs">
				<T k="pwa.iosTitle" />
			</p>
			<ol className="text-muted-foreground list-decimal space-y-2 pl-4 text-xs">
				<li>
					<T k="pwa.iosShareButton" /> <Upload className="inline size-3" />{" "}
					<T k="pwa.iosAtBottom" />
				</li>
				<li>
					<T k="pwa.iosAddHome" />
				</li>
				<li>
					<T k="pwa.iosAddButton" />
				</li>
			</ol>
			<p className="text-muted-foreground bg-muted/50 rounded p-2 text-xs">
				<T k="pwa.iosNote" />
			</p>
		</div>
	)
}

function DesktopInstructions({
	canInstall,
	onInstall,
	onInstallComplete,
}: {
	canInstall: boolean
	onInstall: () => Promise<"accepted" | "dismissed" | null>
	onInstallComplete?: () => void
}) {
	async function handleInstall() {
		let result = await onInstall()
		if (result === "accepted") onInstallComplete?.()
	}

	if (canInstall) {
		return (
			<div className="space-y-3">
				<p className="text-muted-foreground text-xs">
					<T k="pwa.directInstallSupport" />
				</p>
				<Button onClick={handleInstall} className="w-full">
					<T k="pwa.installApp" />
				</Button>
			</div>
		)
	}

	return (
		<div className="space-y-3">
			<p className="text-muted-foreground text-xs">
				<T k="pwa.desktopVary" />
			</p>
			<div className="space-y-3 text-xs">
				<div>
					<p className="font-medium">
						<T k="pwa.desktopChromeEdge" />
					</p>
					<p className="text-muted-foreground">
						<T k="pwa.desktopChromeEdgeSteps" />
					</p>
				</div>
				<div>
					<p className="font-medium">
						<T k="pwa.desktopSafari" />
					</p>
					<p className="text-muted-foreground">
						<T k="pwa.desktopSafariSteps" />
					</p>
				</div>
				<div>
					<p className="font-medium">
						<T k="pwa.desktopFirefox" />
					</p>
					<p className="text-muted-foreground">
						<T k="pwa.desktopFirefoxSteps" />
					</p>
				</div>
			</div>
		</div>
	)
}

function GenericInstructions() {
	return (
		<div className="space-y-3">
			<p className="text-muted-foreground text-xs">
				<T k="pwa.genericTitle" />
			</p>
			<ol className="text-muted-foreground list-decimal space-y-2 pl-4 text-xs">
				<li>
					<T k="pwa.genericStep1" />
				</li>
				<li>
					<T k="pwa.genericStep2" />
				</li>
			</ol>
		</div>
	)
}

type UpdateToastLabels = {
	updateAvailable: string
	updateDescription: string
	updateAction: string
	whatsNew: string
	moreLabel: (count: number) => string
}

let CHANGELOG_URL = "/changelog"
let UPDATE_TOAST_ID = "pwa-update"

// Only the newest entry goes in the toast; the full history lives on the
// changelog page, which stays readable however far behind the reader is.
function showUpdateToast({
	notes,
	labels,
	onReload,
	onDismiss,
}: {
	notes: ChangelogEntry[]
	labels: UpdateToastLabels
	onReload: () => void
	onDismiss: () => void
}) {
	let newest = notes[0]
	if (!newest) {
		toast(labels.updateAvailable, {
			id: UPDATE_TOAST_ID,
			description: labels.updateDescription,
			duration: Infinity,
			action: { label: labels.updateAction, onClick: onReload },
			onDismiss,
		})
		return
	}

	let olderNoteCount = countNotes(notes.slice(1))

	toast(
		<div className="flex flex-col gap-3">
			<div>
				<div className="font-medium">{labels.updateAvailable}</div>
				<ul className="text-muted-foreground mt-1.5 list-disc space-y-1 pl-4 text-sm">
					{newest.notes.map((note, index) => (
						<li key={`${newest.id}-${index}`}>{note}</li>
					))}
				</ul>
				{olderNoteCount > 0 && (
					<div className="text-muted-foreground mt-1.5 text-sm">
						{labels.moreLabel(olderNoteCount)}
					</div>
				)}
			</div>
			<div className="flex flex-row-reverse items-center justify-start gap-3">
				<Button
					size="sm"
					onClick={() => {
						toast.dismiss(UPDATE_TOAST_ID)
						onReload()
					}}
				>
					{labels.updateAction}
				</Button>
				<Button
					variant="link"
					size="sm"
					className="text-muted-foreground"
					render={
						<a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer" />
					}
				>
					{labels.whatsNew}
				</Button>
			</div>
		</div>,
		{ id: UPDATE_TOAST_ID, duration: Infinity, onDismiss },
	)
}

function usePWAInstallPrompt() {
	let [deferredPrompt, setDeferredPrompt] =
		useState<BeforeInstallPromptEvent | null>(null)
	let [canInstall, setCanInstall] = useState(false)

	useEffect(() => {
		function handleBeforeInstallPrompt(e: Event) {
			e.preventDefault()
			setDeferredPrompt(e as BeforeInstallPromptEvent)
			setCanInstall(true)
		}

		function handleAppInstalled() {
			setDeferredPrompt(null)
			setCanInstall(false)
		}

		window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
		window.addEventListener("appinstalled", handleAppInstalled)

		return () => {
			window.removeEventListener(
				"beforeinstallprompt",
				handleBeforeInstallPrompt,
			)
			window.removeEventListener("appinstalled", handleAppInstalled)
		}
	}, [])

	async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
		if (!deferredPrompt) return null

		await deferredPrompt.prompt()
		let choiceResult = await deferredPrompt.userChoice

		setDeferredPrompt(null)
		setCanInstall(false)

		return choiceResult.outcome
	}

	return { canInstall, promptInstall }
}

function usePWAInstallHintDismissed() {
	let [dismissed, setDismissedState] = useState(() => {
		try {
			return localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === "true"
		} catch {
			return false
		}
	})

	function setDismissed(value: boolean) {
		setDismissedState(value)
		try {
			if (value) {
				localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, "true")
			} else {
				localStorage.removeItem(INSTALL_HINT_DISMISSED_KEY)
			}
		} catch {
			// Ignore localStorage errors (e.g. in private browsing)
		}
	}

	return { dismissed, setDismissed }
}
