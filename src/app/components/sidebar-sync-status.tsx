import { useState } from "react"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { useAccount, useIsAuthenticated, useLogOut } from "jazz-tools/react"
import { Button } from "@/app/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "@/app/components/ui/dropdown-menu"
import { AuthDialog } from "@/app/features/auth"
import { ThemeSubmenu, useTheme } from "@/app/components/appearance"
import { usePWA } from "@/app/lib/pwa"
import { useIsOnline } from "@/app/hooks/use-online"
import { UserAccount } from "@/schema"
import {
	ChevronUp,
	Cloud,
	CloudOff,
	Globe,
	HardDrive,
	LogOut,
	Settings,
	WifiOff,
} from "lucide-react"
import { T, useIntl } from "@/shared/intl/setup"
import { StorageModeMenuItems } from "./storage-mode-menu"

export { SidebarSyncStatus }

function SidebarSyncStatus() {
	let navigate = useNavigate()
	let location = useLocation()
	let isFilesystem = location.pathname === "/local"
	let logOut = useLogOut()
	let isAuthenticated = useIsAuthenticated()
	let me = useAccount(UserAccount, { resolve: { profile: true, root: true } })
	let [authOpen, setAuthOpen] = useState(false)
	let isOnline = useIsOnline()
	let { theme, setTheme } = useTheme()
	let { needRefresh } = usePWA()
	let t = useIntl()

	let rawName = me?.$isLoaded ? me.profile.name.trim() || null : null
	let name = rawName === "Anonymous user" ? t("common.anonymousUser") : rawName
	let statusLabel = isAuthenticated
		? isOnline
			? t("sync.syncing")
			: t("sync.offline")
		: t("sync.localOnly")
	let accountLabel = isFilesystem
		? "File System Mode"
		: (name ?? (isAuthenticated ? t("sync.signedIn") : t("sync.localOnly")))
	let StatusIcon = isFilesystem
		? HardDrive
		: isAuthenticated
			? isOnline
				? Cloud
				: WifiOff
			: CloudOff
	let statusIconClassName = isFilesystem
		? "text-muted-foreground"
		: isAuthenticated
			? isOnline
				? "text-green-600 dark:text-green-400"
				: "text-muted-foreground"
			: "text-destructive"

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						nativeButton
						className="relative h-auto w-full flex-1 justify-start gap-2 px-2 py-2 pointer-fine:h-auto"
					>
						<StatusIcon className={statusIconClassName} />
						<div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
							<span className="truncate text-sm font-medium">
								{accountLabel}
							</span>
							{!isFilesystem && (
								<span className="text-muted-foreground truncate text-xs">
									{statusLabel}
								</span>
							)}
						</div>
						<ChevronUp className="text-muted-foreground size-4" />
						{needRefresh && (
							<span className="bg-destructive absolute top-1.5 right-1.5 size-2 rounded-full" />
						)}
					</Button>
				}
			/>
			<DropdownMenuContent align="end" side="top" className="w-56">
				<DropdownMenuItem
					onClick={() =>
						navigate({
							to: "/settings",
							search: { from: location.pathname },
						})
					}
				>
					<Settings />
					<T k="common.settings" />
				</DropdownMenuItem>
				{!isAuthenticated && (
					<DropdownMenuItem onClick={() => setAuthOpen(true)}>
						<CloudOff />
						<T k="common.signIn" />
					</DropdownMenuItem>
				)}
				<ThemeSubmenu theme={theme} setTheme={setTheme} />
				<LanguageSubmenu
					language={me?.$isLoaded ? (me.root?.language ?? "en") : "en"}
					setLanguage={lang => {
						if (me?.$isLoaded && me.root && (lang === "en" || lang === "de")) {
							me.root.$jazz.set("language", lang)
						}
					}}
				/>
				<DropdownMenuSeparator />
				<StorageModeMenuItems />
				{isAuthenticated && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => logOut()}>
							<LogOut />
							<T k="common.logOut" />
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
			<AuthDialog
				open={authOpen}
				onOpenChange={setAuthOpen}
				onSuccess={() => navigate({ to: "/" })}
			/>
		</DropdownMenu>
	)
}

function LanguageSubmenu({
	language,
	setLanguage,
}: {
	language: string
	setLanguage: (lang: string) => void
}) {
	let t = useIntl()

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<Globe />
				{t("settings.language")}
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent>
				<DropdownMenuRadioGroup value={language} onValueChange={setLanguage}>
					<DropdownMenuRadioItem value="en">
						{t("settings.language.en")}
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="de">
						{t("settings.language.de")}
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	)
}
