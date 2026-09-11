import { useState } from "react"
import { FolderOpen, AlertCircle } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import { Switch } from "@/app/components/ui/switch"
import {
	useBackupStore,
	enableBackup,
	disableBackup,
	changeBackupDirectory,
	useSpaceBackupPath,
	setSpaceBackupHandle,
	clearSpaceBackupHandle,
	supportsFileSystemWatch,
	isBackupSupported,
} from "../lib/storage"
import { T, useIntl } from "@/shared/intl/setup"
import {
	SettingsSection,
	SettingsPanel,
	SettingsRow,
	SettingsStatus,
	SettingsActions,
	SettingsBlock,
	SettingsHint,
} from "@/app/components/ui/settings-layout"

export { BackupSettings, SpaceBackupSettings }

function BackupSettings() {
	let t = useIntl()
	let {
		enabled,
		bidirectional,
		directoryName,
		lastBackupAt,
		lastPullAt,
		lastError,
		setBidirectional,
		setLastError,
	} = useBackupStore()
	let [pendingAction, setPendingAction] = useState<
		"enable" | "disable" | "change" | null
	>(null)
	let isLoading = pendingAction !== null
	let canWatchFileSystem = supportsFileSystemWatch()

	if (!isBackupSupported()) {
		return <UnsupportedBrowserCallout />
	}

	async function handleEnable() {
		setPendingAction("enable")
		setLastError(null)
		try {
			let result = await enableBackup()
			if (!result.success && result.error && result.error !== "Cancelled") {
				setLastError(result.error)
			}
		} finally {
			setPendingAction(null)
		}
	}

	async function handleDisable() {
		setPendingAction("disable")
		try {
			await disableBackup()
		} finally {
			setPendingAction(null)
		}
	}

	async function handleChangeDirectory() {
		setPendingAction("change")
		setLastError(null)
		try {
			let result = await changeBackupDirectory()
			if (!result.success && result.error && result.error !== "Cancelled") {
				setLastError(result.error)
			}
		} finally {
			setPendingAction(null)
		}
	}

	let lastBackupDate = lastBackupAt ? new Date(lastBackupAt) : null
	let formattedLastBackup = lastBackupDate
		? lastBackupDate.toLocaleString()
		: null

	let lastPullDate = lastPullAt ? new Date(lastPullAt) : null
	let formattedLastPull = lastPullDate ? lastPullDate.toLocaleString() : null

	return (
		<SettingsSection title={<T k="backup.title" />}>
			<SettingsPanel>
				{enabled ? (
					<>
						<SettingsStatus
							tone="ok"
							icon={<FolderOpen className="size-4 shrink-0" />}
							description={
								<>
									<div className="truncate">
										<T k="backup.enabled.folder" />{" "}
										<span
											className="font-medium"
											title={directoryName ?? undefined}
										>
											{directoryName}
										</span>
									</div>
									{formattedLastBackup && (
										<div className="mt-0.5 text-sm sm:text-xs">
											{t("backup.enabled.lastBackup", {
												date: formattedLastBackup,
											})}
										</div>
									)}
									{bidirectional && formattedLastPull && (
										<div className="mt-0.5 text-sm sm:text-xs">
											{t("backup.enabled.lastSync", {
												date: formattedLastPull,
											})}
										</div>
									)}
								</>
							}
						>
							{t(
								bidirectional
									? "backup.enabled.statusBidirectional"
									: "backup.enabled.status",
							)}
						</SettingsStatus>
						{lastError && (
							<SettingsStatus
								tone="error"
								icon={<AlertCircle className="size-4 shrink-0" />}
							>
								{lastError}
							</SettingsStatus>
						)}
						<SettingsRow
							htmlFor="backup-bidirectional"
							label={<T k="backup.enabled.syncChanges" />}
							description={
								<T
									k={
										canWatchFileSystem
											? "backup.enabled.syncDescription.supported"
											: "backup.enabled.syncDescription.unsupported"
									}
								/>
							}
							className={canWatchFileSystem ? undefined : "opacity-50"}
						>
							<Switch
								id="backup-bidirectional"
								checked={bidirectional}
								onCheckedChange={setBidirectional}
								disabled={!canWatchFileSystem || isLoading}
							/>
						</SettingsRow>
						<SettingsActions>
							<Button
								onClick={handleChangeDirectory}
								variant="outline"
								size="sm"
								disabled={isLoading}
							>
								{pendingAction === "change"
									? t("backup.enabled.changing")
									: t("backup.enabled.changeFolder")}
							</Button>
							<Button
								onClick={handleDisable}
								variant="ghost"
								size="sm"
								disabled={isLoading}
							>
								{pendingAction === "disable"
									? t("backup.enabled.disabling")
									: t("backup.enabled.disable")}
							</Button>
						</SettingsActions>
					</>
				) : (
					<>
						<SettingsStatus description={<T k="backup.disabled.description" />}>
							<T k="backup.disabled.status" />
						</SettingsStatus>
						<SettingsActions>
							<Button
								onClick={handleEnable}
								variant="outline"
								size="sm"
								disabled={isLoading}
							>
								<FolderOpen className="mr-1.5 size-3.5" />
								{pendingAction === "enable"
									? t("backup.disabled.choosing")
									: t("backup.disabled.choose")}
							</Button>
						</SettingsActions>
					</>
				)}
			</SettingsPanel>
		</SettingsSection>
	)
}

interface SpaceBackupSettingsProps {
	spaceId: string
	isAdmin: boolean
}

function SpaceBackupSettings({ spaceId, isAdmin }: SpaceBackupSettingsProps) {
	let t = useIntl()
	let { directoryName, setDirectoryName } = useSpaceBackupPath(spaceId)
	let [pendingAction, setPendingAction] = useState<
		"choose" | "change" | "clear" | null
	>(null)
	let [error, setError] = useState<string | null>(null)
	let isLoading = pendingAction !== null

	if (!isBackupSupported()) {
		return <UnsupportedBrowserCallout />
	}

	async function handleChooseFolder() {
		setPendingAction("choose")
		setError(null)
		try {
			let handle = await window.showDirectoryPicker({ mode: "readwrite" })
			await setSpaceBackupHandle(spaceId, handle)
			setDirectoryName(handle.name)
		} catch (e) {
			if (!(e instanceof Error && e.name === "AbortError")) {
				setError(t("backup.error"))
				console.error("Failed to select folder:", e)
			}
		} finally {
			setPendingAction(null)
		}
	}

	async function handleChangeFolder() {
		setPendingAction("change")
		setError(null)
		try {
			let handle = await window.showDirectoryPicker({ mode: "readwrite" })
			await setSpaceBackupHandle(spaceId, handle)
			setDirectoryName(handle.name)
		} catch (e) {
			if (!(e instanceof Error && e.name === "AbortError")) {
				setError(t("backup.error"))
				console.error("Failed to select folder:", e)
			}
		} finally {
			setPendingAction(null)
		}
	}

	async function handleClear() {
		setPendingAction("clear")
		setError(null)
		try {
			await clearSpaceBackupHandle(spaceId)
			setDirectoryName(null)
		} catch {
			setError(t("backup.clearError"))
		} finally {
			setPendingAction(null)
		}
	}

	return (
		<SettingsSection title={<T k="backup.space.title" />}>
			<SettingsPanel>
				{directoryName ? (
					<>
						<SettingsStatus
							tone="ok"
							icon={<FolderOpen className="size-4 shrink-0" />}
							description={
								<span className="truncate">
									<T k="backup.space.folder" />{" "}
									<span className="font-medium" title={directoryName}>
										{directoryName}
									</span>
								</span>
							}
						>
							<T k="backup.space.set" />
						</SettingsStatus>
						{error && (
							<SettingsStatus
								tone="error"
								icon={<AlertCircle className="size-4 shrink-0" />}
							>
								{error}
							</SettingsStatus>
						)}
						<SettingsActions>
							<Button
								onClick={handleChangeFolder}
								variant="outline"
								size="sm"
								disabled={isLoading || !isAdmin}
							>
								{pendingAction === "change" || pendingAction === "choose"
									? t("backup.space.changing")
									: t("backup.space.changeFolder")}
							</Button>
							<Button
								onClick={handleClear}
								variant="ghost"
								size="sm"
								disabled={isLoading || !isAdmin}
							>
								{pendingAction === "clear"
									? t("backup.space.clearing")
									: t("backup.space.clear")}
							</Button>
						</SettingsActions>
						{!isAdmin && (
							<SettingsHint>
								<T k="backup.space.adminOnly" />
							</SettingsHint>
						)}
					</>
				) : (
					<>
						<SettingsStatus description={<T k="backup.space.description" />}>
							<T k="backup.space.notSet" />
						</SettingsStatus>
						{error && (
							<SettingsStatus
								tone="error"
								icon={<AlertCircle className="size-4 shrink-0" />}
							>
								{error}
							</SettingsStatus>
						)}
						<SettingsActions>
							<Button
								onClick={handleChooseFolder}
								variant="outline"
								size="sm"
								disabled={isLoading || !isAdmin}
							>
								<FolderOpen className="mr-1.5 size-3.5" />
								{pendingAction === "choose"
									? t("backup.space.choosing")
									: t("backup.space.choose")}
							</Button>
						</SettingsActions>
						{!isAdmin && (
							<SettingsHint>
								<T k="backup.space.adminOnlySet" />
							</SettingsHint>
						)}
					</>
				)}
			</SettingsPanel>
		</SettingsSection>
	)
}

function UnsupportedBrowserCallout() {
	return (
		<SettingsSection title={<T k="backup.title" />}>
			<SettingsPanel>
				<SettingsBlock>
					<div className="text-muted-foreground flex items-start gap-2 text-base/6 text-pretty sm:text-sm/5">
						<AlertCircle className="mt-0.5 size-4 shrink-0" />
						<div>
							<T k="backup.unsupported.description" />
							<div className="mt-1 text-sm sm:text-xs">
								<T k="backup.unsupported.note" />
							</div>
						</div>
					</div>
				</SettingsBlock>
			</SettingsPanel>
		</SettingsSection>
	)
}
