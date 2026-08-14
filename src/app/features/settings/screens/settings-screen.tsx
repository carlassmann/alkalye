import { useState, useRef } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import {
	useAccount,
	useIsAuthenticated,
	usePassphraseAuth,
	useLogOut,
} from "jazz-tools/react"
import { co, type ResolveQuery } from "jazz-tools"
import {
	ArrowLeft,
	Copy,
	Check,
	Cloud,
	CloudOff,
	Pencil,
	Minus,
	Plus,
	RefreshCw,
	WifiOff,
	Upload,
	Download,
	Trash2,
	Palette,
	Loader2,
	AlertCircle,
} from "lucide-react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { Button } from "@/app/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/app/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/app/components/ui/field"
import { Input } from "@/app/components/ui/input"
import { Textarea } from "@/app/components/ui/textarea"
import { Switch } from "@/app/components/ui/switch"
import { UserAccount, Theme, ThemeAsset, Settings } from "@/schema"
import {
	parseThemeZip,
	exportTheme,
	type ThemeUploadError,
	type ThemeExportQuery,
} from "@/app/features/themes"
import { createImage } from "jazz-tools/media"
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select"
import { useTheme, ThemeToggle } from "@/app/components/appearance"
import { AuthDialog, wordlist } from "@/app/features/auth"
import {
	useEditorSettings,
	DEFAULT_EDITOR_SETTINGS,
	type EditorSettingsData,
} from "@/app/features/editor"
import { Footer } from "@/app/components/footer"
import { usePWA, PWAInstallDialog } from "@/app/lib/pwa"
import { useIsPWAInstalled } from "@/app/lib/platform"
import { BackupSettings } from "@/app/features/backup"
import {
	Tooltip,
	TooltipTrigger,
	TooltipContent,
} from "@/app/components/ui/tooltip"
import { useIsOnline } from "@/app/hooks/use-online"
import { testIds } from "@/app/lib/test-ids"
import {
	clearReloadDiagnostics,
	readReloadDiagnostics,
	reloadDiagnosticsReport,
} from "@/app/lib/reload-diagnostics"
import { useIntl, T } from "@/shared/intl/setup"
import { makeProfileNameSchema } from "../lib/profile-name"

export { SettingsScreen, settingsQuery }
export type { LoadedAccount, SettingsLoaderData, SettingsSearch }

let settingsQuery = {
	profile: true,
	root: {
		settings: true,
		themes: {
			$each: {
				css: true,
				template: true,
				thumbnail: { original: true },
				assets: { $each: { data: true } },
			},
		},
	},
} as const satisfies ResolveQuery<typeof UserAccount>

type LoadedAccount = co.loaded<typeof UserAccount, typeof settingsQuery>

interface SettingsLoaderData {
	me: LoadedAccount | null
}

interface SettingsSearch {
	from?: string
}

interface SettingsScreenProps {
	loaderData: SettingsLoaderData
	search: SettingsSearch
}

function SettingsScreen({ loaderData, search }: SettingsScreenProps) {
	let t = useIntl()
	let { theme, setTheme } = useTheme()
	let { from } = search
	let subscribedMe = useAccount(UserAccount, { resolve: settingsQuery })
	let me = subscribedMe.$isLoaded ? subscribedMe : loaderData.me
	let isAuthenticated = useIsAuthenticated()

	return (
		<>
			<title>{t("settings.title")}</title>
			<div
				className="bg-background fixed inset-0 overflow-auto"
				style={{
					paddingTop: "calc(48px + env(safe-area-inset-top))",
					paddingBottom: "env(safe-area-inset-bottom)",
					paddingLeft: "env(safe-area-inset-left)",
					paddingRight: "env(safe-area-inset-right)",
				}}
			>
				<div
					className="bg-background border-border fixed top-0 right-0 left-0 z-10 flex items-center justify-center border-b"
					style={{
						paddingTop: "env(safe-area-inset-top)",
						paddingLeft: "env(safe-area-inset-left)",
						paddingRight: "env(safe-area-inset-right)",
						height: "calc(48px + env(safe-area-inset-top))",
					}}
				>
					<div className="flex w-full max-w-2xl items-center gap-3 px-4">
						<Link to={from ?? "/"}>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("settings.back")}
							>
								<ArrowLeft className="size-4" />
							</Button>
						</Link>
						<h1 className="text-foreground text-lg font-semibold">
							<T k="settings.title" />
						</h1>
					</div>
				</div>
				<div className="mx-auto max-w-2xl px-4 py-8">
					<div className="space-y-8">
						<ProfileSection me={me} />
						<SyncSection isAuthenticated={isAuthenticated} />
						<BackupSettings />
						<section>
							<h2 className="text-muted-foreground mb-3 text-sm font-medium">
								<T k="settings.appearance" />
							</h2>
							<ThemeToggle theme={theme} setTheme={setTheme} showLabel />
						</section>
						<LanguageSection me={me} />
						<ThemesSection me={me} />
						<EditorSection settings={me?.root?.settings ?? null} />
						<InstallationSection />
						<AppSection />
						<ReloadDiagnosticsSection />
					</div>
					<Footer />
				</div>
			</div>
		</>
	)
}

interface ProfileSectionProps {
	me: LoadedAccount | null
}

function makeNameSchema(t: ReturnType<typeof useIntl>) {
	return z.object({
		name: makeProfileNameSchema({
			required: t("settings.profile.nameRequired"),
			tooLong: t("settings.profile.nameTooLong"),
		}),
	})
}

function ProfileSection({ me }: ProfileSectionProps) {
	let t = useIntl()
	let [dialogOpen, setDialogOpen] = useState(false)

	if (!me) return null

	let name = me.profile?.name ?? t("common.anonymous")

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				<T k="settings.profile" />
			</h2>
			<div className="bg-muted/30 rounded-lg p-4">
				<div className="flex items-center justify-between">
					<div>
						<div className="text-muted-foreground mb-1 text-xs">
							<T k="settings.profile.displayName" />
						</div>
						<div className="text-lg font-medium">{name}</div>
					</div>
					<Button
						onClick={() => setDialogOpen(true)}
						variant="ghost"
						size="icon-sm"
						aria-label={t("settings.profile.editName")}
					>
						<Pencil className="size-4" />
					</Button>
				</div>
			</div>
			<EditNameDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				currentName={me.profile?.name ?? ""}
				onSave={newName => {
					if (!me.profile) return
					me.profile.$jazz.set("name", newName)
				}}
			/>
		</section>
	)
}

interface EditNameDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	currentName: string
	onSave: (name: string) => void
}

function EditNameDialog({
	open,
	onOpenChange,
	currentName,
	onSave,
}: EditNameDialogProps) {
	let t = useIntl()
	let nameSchema = makeNameSchema(t)
	let form = useForm({
		defaultValues: { name: currentName },
		validators: { onSubmit: nameSchema },
		onSubmit: ({ value }) => {
			let result = nameSchema.safeParse(value)
			if (!result.success) return
			onSave(result.data.name)
			onOpenChange(false)
		},
	})

	function handleOpenChangeComplete(isOpen: boolean) {
		if (isOpen) {
			form.reset({ name: currentName })
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			onOpenChangeComplete={handleOpenChangeComplete}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<T k="settings.profile.editName" />
					</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={e => {
						e.preventDefault()
						form.handleSubmit()
					}}
					className="space-y-4"
				>
					<form.Field name="name">
						{field => {
							let isInvalid =
								field.state.meta.isTouched && !field.state.meta.isValid
							return (
								<Field data-invalid={isInvalid}>
									<FieldLabel htmlFor={field.name}>
										<T k="settings.profile.displayName" />
									</FieldLabel>
									<Input
										id={field.name}
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={e => field.handleChange(e.target.value)}
										aria-invalid={isInvalid}
										placeholder={t("settings.profile.yourName")}
										autoFocus
									/>
									{isInvalid && <FieldError errors={field.state.meta.errors} />}
								</Field>
							)
						}}
					</form.Field>
					<DialogFooter>
						<Button type="submit">
							<T k="settings.save" />
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

interface LanguageSectionProps {
	me: LoadedAccount | null
}

function LanguageSection({ me }: LanguageSectionProps) {
	let t = useIntl()
	let currentLanguage = me?.root?.language || "en"

	function handleLanguageChange(value: string | null) {
		if (!me?.root) return
		if (value !== "en" && value !== "de") return
		me.root.$jazz.set("language", value)
	}

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				<T k="settings.language" />
			</h2>
			<Select value={currentLanguage} onValueChange={handleLanguageChange}>
				<SelectTrigger aria-label={t("settings.language")}>
					<SelectValue>
						{currentLanguage === "de"
							? t("settings.language.de")
							: t("settings.language.en")}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="en">
						<T k="settings.language.en" />
					</SelectItem>
					<SelectItem value="de">
						<T k="settings.language.de" />
					</SelectItem>
				</SelectContent>
			</Select>
		</section>
	)
}

interface ThemesSectionProps {
	me: LoadedAccount | null
}

function ThemesSection({ me }: ThemesSectionProps) {
	let t = useIntl()
	let fileInputRef = useRef<HTMLInputElement>(null)
	let [isUploading, setIsUploading] = useState(false)
	let [uploadError, setUploadError] = useState<ThemeUploadError | null>(null)
	let [themeToDelete, setThemeToDelete] = useState<co.loaded<
		typeof Theme
	> | null>(null)
	let [exportingThemeId, setExportingThemeId] = useState<string | null>(null)

	if (!me?.root) return null

	let themes = me.root.themes ?? []

	async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
		let file = e.target.files?.[0]
		if (!file || !me?.root) return

		e.target.value = ""

		setIsUploading(true)
		setUploadError(null)

		let result = await parseThemeZip(file)

		if (!result.ok) {
			setUploadError(result.error)
			setIsUploading(false)
			return
		}

		let parsed = result.theme
		let owner = me.root.$jazz.owner

		let assets: co.loaded<typeof ThemeAsset>[] = []
		for (let asset of parsed.assets) {
			let buffer = await asset.file.arrayBuffer()
			let fileStream = await co
				.fileStream()
				.createFromArrayBuffer(buffer, asset.mimeType, asset.name, { owner })
			let themeAsset = ThemeAsset.create(
				{
					name: asset.name,
					mimeType: asset.mimeType,
					data: fileStream,
					createdAt: new Date(),
				},
				owner,
			)
			assets.push(themeAsset)
		}

		let thumbnail = parsed.thumbnail
			? await createImage(parsed.thumbnail, { owner, maxSize: 256 })
			: undefined

		let now = new Date()
		let theme = Theme.create(
			{
				version: 1,
				name: parsed.name,
				author: parsed.author,
				description: parsed.description,
				type: parsed.type,
				css: co.plainText().create(parsed.css, owner),
				template: parsed.template
					? co.plainText().create(parsed.template, owner)
					: undefined,
				presets: parsed.presets ? JSON.stringify(parsed.presets) : undefined,
				assets:
					assets.length > 0
						? co.list(ThemeAsset).create(assets, owner)
						: undefined,
				thumbnail,
				createdAt: now,
				updatedAt: now,
			},
			owner,
		)

		if (!me.root.themes) {
			me.root.$jazz.set("themes", co.list(Theme).create([], owner))
		}
		me.root.themes!.$jazz.push(theme)

		setIsUploading(false)
	}

	function handleDeleteTheme() {
		if (!themeToDelete || !me?.root?.themes) return

		let index = me.root.themes.findIndex(
			t => t?.$jazz.id === themeToDelete.$jazz.id,
		)
		if (index !== -1) {
			me.root.themes.$jazz.splice(index, 1)
		}
		setThemeToDelete(null)
	}

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				<T k="settings.themes" />
			</h2>
			<div className="bg-muted/30 rounded-lg p-4">
				{uploadError && (
					<div className="bg-destructive/10 text-destructive mb-4 flex items-start gap-2 rounded-md p-3 text-sm">
						<AlertCircle className="mt-0.5 size-4 shrink-0" />
						<div>
							<div className="font-medium">{uploadError.message}</div>
							{"errors" in uploadError && uploadError.errors.length > 0 && (
								<ul className="mt-1 list-inside list-disc text-xs opacity-80">
									{uploadError.errors.slice(0, 3).map((err, i) => (
										<li key={i}>{err}</li>
									))}
									{uploadError.errors.length > 3 && (
										<li>
											{t("settings.themes.moreErrors", {
												count: String(uploadError.errors.length - 3),
											})}
										</li>
									)}
								</ul>
							)}
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							className="-mt-1 -mr-1 ml-auto"
							onClick={() => setUploadError(null)}
						>
							<span className="sr-only">
								<T k="settings.themes.dismiss" />
							</span>
							<span aria-hidden>×</span>
						</Button>
					</div>
				)}

				{themes.length === 0 ? (
					<div className="text-muted-foreground py-4 text-center text-sm">
						<Palette className="mx-auto mb-2 size-8 opacity-50" />
						<p>
							<T k="settings.themes.noThemes" />
						</p>
						<p className="mt-1 text-xs opacity-70">
							<T k="settings.themes.uploadHint" />
						</p>
					</div>
				) : (
					<>
						<div className="mb-4 space-y-2">
							{themes.map(theme => {
								if (!theme) return null
								return (
									<div
										key={theme.$jazz.id}
										className="bg-background flex items-center gap-3 rounded-md border p-3"
									>
										<Palette className="text-muted-foreground size-4 shrink-0" />
										<div className="min-w-0 flex-1">
											<div className="truncate font-medium">{theme.name}</div>
											<div className="text-muted-foreground text-xs">
												{theme.type === "both"
													? t("settings.themes.previewAndSlideshow")
													: theme.type === "preview"
														? t("settings.themes.preview")
														: t("settings.themes.slideshow")}
												{theme.author &&
													` • ${t("settings.themes.by")} ${theme.author}`}
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon-sm"
											onClick={makeExportTheme(theme, setExportingThemeId)}
											disabled={exportingThemeId === theme.$jazz.id}
											aria-label={`Export ${theme.name}`}
										>
											{exportingThemeId === theme.$jazz.id ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<Download className="size-4" />
											)}
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											onClick={() => setThemeToDelete(theme)}
											aria-label={`Delete ${theme.name}`}
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								)
							})}
						</div>
						<DefaultThemeSettings
							settings={me.root.settings}
							themes={me.root.themes}
						/>
					</>
				)}

				<input
					ref={fileInputRef}
					type="file"
					accept=".zip"
					className="hidden"
					onChange={handleFileSelect}
				/>
				<Button
					onClick={() => fileInputRef.current?.click()}
					variant="outline"
					size="sm"
					disabled={isUploading}
				>
					{isUploading ? (
						<>
							<Loader2 className="mr-1.5 size-3.5 animate-spin" />
							<T k="settings.themes.uploading" />
						</>
					) : (
						<>
							<Upload className="mr-1.5 size-3.5" />
							<T k="settings.themes.uploadTheme" />
						</>
					)}
				</Button>
			</div>

			<ConfirmDialog
				open={!!themeToDelete}
				onOpenChange={open => !open && setThemeToDelete(null)}
				title={t("settings.themes.deleteTitle")}
				description={t("settings.themes.deleteDescription", {
					name: themeToDelete?.name ?? "",
				})}
				confirmLabel={t("settings.themes.deleteConfirm")}
				onConfirm={handleDeleteTheme}
				variant="destructive"
			/>
		</section>
	)
}

interface DefaultThemeSettingsProps {
	settings: co.loaded<typeof Settings> | null | undefined
	themes: LoadedAccount["root"]["themes"]
}

type LoadedTheme = co.loaded<typeof Theme>

function DefaultThemeSettings({ settings, themes }: DefaultThemeSettingsProps) {
	let t = useIntl()
	let themesList = themes ?? []

	function isLoadedTheme(t: unknown): t is LoadedTheme {
		return (
			!!t && typeof t === "object" && "$isLoaded" in t && t.$isLoaded === true
		)
	}

	let loadedThemes = Array.from(themesList).filter(isLoadedTheme)
	let previewThemes = loadedThemes.filter(
		t => t.type === "preview" || t.type === "both",
	)
	let slideshowThemes = loadedThemes.filter(
		t => t.type === "slideshow" || t.type === "both",
	)

	function handlePreviewThemeChange(value: string | null) {
		if (!settings || !value) return
		if (value === "__none__") {
			settings.$jazz.set("defaultPreviewTheme", undefined)
		} else {
			settings.$jazz.set("defaultPreviewTheme", value)
		}
	}

	function handleSlideshowThemeChange(value: string | null) {
		if (!settings || !value) return
		if (value === "__none__") {
			settings.$jazz.set("defaultSlideshowTheme", undefined)
		} else {
			settings.$jazz.set("defaultSlideshowTheme", value)
		}
	}

	if (previewThemes.length === 0 && slideshowThemes.length === 0) {
		return null
	}

	return (
		<div className="border-border/50 mb-4 space-y-3 border-t pt-4">
			<div className="text-muted-foreground text-xs font-medium">
				<T k="settings.themes.defaultThemes" />
			</div>
			{previewThemes.length > 0 && (
				<div className="flex items-center justify-between gap-4">
					<span className="text-sm">
						<T k="settings.themes.preview" />
					</span>
					<Select
						value={settings?.defaultPreviewTheme ?? "__none__"}
						onValueChange={handlePreviewThemeChange}
					>
						<SelectTrigger className="w-40">
							<SelectValue>
								{getThemeSelectLabel(
									settings?.defaultPreviewTheme ?? "__none__",
									t,
								)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="__none__">
								<T k="settings.themes.none" />
							</SelectItem>
							{previewThemes.map(theme => (
								<SelectItem key={theme.$jazz.id} value={theme.name}>
									{theme.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
			{slideshowThemes.length > 0 && (
				<div className="flex items-center justify-between gap-4">
					<span className="text-sm">
						<T k="settings.themes.slideshow" />
					</span>
					<Select
						value={settings?.defaultSlideshowTheme ?? "__none__"}
						onValueChange={handleSlideshowThemeChange}
					>
						<SelectTrigger className="w-40">
							<SelectValue>
								{getThemeSelectLabel(
									settings?.defaultSlideshowTheme ?? "__none__",
									t,
								)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="__none__">
								<T k="settings.themes.none" />
							</SelectItem>
							{slideshowThemes.map(theme => (
								<SelectItem key={theme.$jazz.id} value={theme.name}>
									{theme.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
		</div>
	)
}

interface SyncSectionProps {
	isAuthenticated: boolean
}

function SyncSection({ isAuthenticated }: SyncSectionProps) {
	if (isAuthenticated) {
		return <SignedInView />
	}
	return <SignInView />
}

function SignInView() {
	let navigate = useNavigate()
	let [authOpen, setAuthOpen] = useState(false)

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				<T k="settings.sync.title" />
			</h2>
			<div className="text-muted-foreground mb-4 flex items-center gap-2">
				<CloudOff className="size-4" />
				<span className="text-sm">
					<T k="settings.sync.localOnly" />
				</span>
			</div>
			<Button
				onClick={() => setAuthOpen(true)}
				size="sm"
				variant="outline"
				data-testid={testIds.auth.settingsSignIn}
			>
				<T k="settings.sync.signIn" />
			</Button>
			<AuthDialog
				open={authOpen}
				onOpenChange={setAuthOpen}
				onSuccess={() => navigate({ to: "/" })}
			/>
		</section>
	)
}

interface EditorSectionProps {
	settings: LoadedAccount["root"]["settings"] | null
}

function EditorSection({ settings: jazzSettings }: EditorSectionProps) {
	let t = useIntl()
	let { settings, setSettings, resetSettings } = useEditorSettings(jazzSettings)

	return (
		<section>
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-muted-foreground text-sm font-medium">
					<T k="settings.editor" />
				</h2>
				<Button
					variant="ghost"
					size="sm"
					onClick={resetSettings}
					className="text-muted-foreground h-auto px-2 py-1 text-xs"
				>
					<T k="settings.editor.resetDefaults" />
				</Button>
			</div>
			<div className="bg-muted/30 space-y-3 rounded-lg p-4">
				<NumericSetting
					label={t("settings.editor.lineWidth")}
					value={settings.lineWidth}
					defaultValue={DEFAULT_EDITOR_SETTINGS.lineWidth}
					onChange={v => setSettings({ lineWidth: v })}
					step={5}
					min={60}
					max={120}
					unit="ch"
				/>

				<NumericSetting
					label={t("settings.editor.fontSize")}
					value={settings.fontSize}
					defaultValue={DEFAULT_EDITOR_SETTINGS.fontSize}
					onChange={v => setSettings({ fontSize: v })}
					step={1}
					min={10}
					max={30}
					unit="px"
				/>

				<NumericSetting
					label={t("settings.editor.lineHeight")}
					value={settings.lineHeight}
					defaultValue={DEFAULT_EDITOR_SETTINGS.lineHeight}
					onChange={v => setSettings({ lineHeight: v })}
					step={0.1}
					min={1.2}
					max={2.0}
					decimals={1}
				/>

				<NumericSetting
					label={t("settings.editor.letterSpacing")}
					value={settings.letterSpacing}
					defaultValue={DEFAULT_EDITOR_SETTINGS.letterSpacing}
					onChange={v => setSettings({ letterSpacing: v })}
					step={0.01}
					min={-0.1}
					max={0.1}
					unit="em"
					decimals={2}
				/>

				<div className="border-border/50 space-y-3 border-t pt-3">
					<ToggleSetting
						id="strikethrough-toggle"
						label={
							<>
								<span
									className={
										settings.strikethroughDoneTasks ? "line-through" : ""
									}
								>
									<T k="settings.editor.strikethrough" />
								</span>{" "}
								<T k="settings.editor.doneTasks" />
							</>
						}
						checked={settings.strikethroughDoneTasks}
						onChange={v => setSettings({ strikethroughDoneTasks: v })}
					/>

					<ToggleSetting
						id="fade-toggle"
						label={
							<>
								<span className={settings.fadeDoneTasks ? "opacity-50" : ""}>
									<T k="settings.editor.fade" />
								</span>{" "}
								<T k="settings.editor.doneTasks" />
							</>
						}
						checked={settings.fadeDoneTasks}
						onChange={v => setSettings({ fadeDoneTasks: v })}
					/>

					<ToggleSetting
						id="highlight-line-toggle"
						label={<T k="settings.editor.highlightLine" />}
						checked={settings.highlightCurrentLine}
						onChange={v => setSettings({ highlightCurrentLine: v })}
						className={
							settings.highlightCurrentLine
								? "bg-foreground/5 -mx-4 rounded px-4"
								: ""
						}
					/>

					<ToggleSetting
						id="auto-sort-toggle"
						label={<T k="settings.editor.autoSortTasks" />}
						checked={settings.autoSortTasks}
						onChange={v => setSettings({ autoSortTasks: v })}
					/>

					<div className="flex min-h-8 items-center justify-between gap-4">
						<label htmlFor="stats-badge-unit" className="text-sm">
							<T k="settings.editor.statsBadge" />
						</label>
						<Select
							value={getStatsBadgeSelectValue(settings)}
							onValueChange={makeHandleStatsBadgeUnitChange(setSettings)}
						>
							<SelectTrigger id="stats-badge-unit" className="w-40">
								<SelectValue>
									{getStatsBadgeSelectLabel(settings, t)}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="words">
									<T k="settings.editor.statsBadge.words" />
								</SelectItem>
								<SelectItem value="sentences">
									<T k="settings.editor.statsBadge.sentences" />
								</SelectItem>
								<SelectItem value="tasks">
									<T k="settings.editor.statsBadge.tasks" />
								</SelectItem>
								<SelectItem value="hide">
									<T k="settings.editor.statsBadge.hide" />
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
			</div>
		</section>
	)
}

interface NumericSettingProps {
	label: string
	value: number
	defaultValue: number
	onChange: (value: number) => void
	step: number
	min: number
	max: number
	unit?: string
	decimals?: number
}

function NumericSetting({
	label,
	value,
	defaultValue,
	onChange,
	step,
	min,
	max,
	unit = "",
	decimals = 0,
}: NumericSettingProps) {
	let t = useIntl()
	let isDefault = Math.abs(value - defaultValue) < 0.001

	function clamp(v: number) {
		return Math.max(min, Math.min(max, Math.round(v * 1000) / 1000))
	}

	function decrement() {
		onChange(clamp(value - step))
	}

	function increment() {
		onChange(clamp(value + step))
	}

	function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
		let parsed = parseFloat(e.target.value)
		if (!isNaN(parsed)) {
			onChange(clamp(parsed))
		}
	}

	return (
		<div className="flex min-h-8 items-center justify-between gap-4">
			<span className="text-sm">{label}</span>
			<div className="flex items-center gap-2">
				{!isDefault && (
					<span className="text-muted-foreground text-xs">
						{t("settings.numericDefault", {
							value: defaultValue.toFixed(decimals),
						})}
					</span>
				)}
				{unit && <span className="text-muted-foreground text-xs">{unit}</span>}
				<div className="flex items-center">
					<Button
						variant="outline"
						size="icon-sm"
						onClick={decrement}
						disabled={value <= min}
						aria-label={t("settings.numericDecrease", { label })}
						className="size-7 rounded-r-none border-r-0"
					>
						<Minus className="size-3" />
					</Button>
					<Input
						type="number"
						aria-label={label}
						value={value.toFixed(decimals)}
						onChange={handleInputChange}
						step={step}
						className="h-7 w-16 [appearance:textfield] rounded-none border-x-0 text-center text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
					/>
					<Button
						variant="outline"
						size="icon-sm"
						onClick={increment}
						disabled={value >= max}
						aria-label={t("settings.numericIncrease", { label })}
						className="size-7 rounded-l-none border-l-0"
					>
						<Plus className="size-3" />
					</Button>
				</div>
			</div>
		</div>
	)
}

interface ToggleSettingProps {
	id: string
	label: React.ReactNode
	checked: boolean
	onChange: (checked: boolean) => void
	className?: string
}

function ToggleSetting({
	id,
	label,
	checked,
	onChange,
	className,
}: ToggleSettingProps) {
	return (
		<div
			className={`flex min-h-8 items-center justify-between gap-4 ${className ?? ""}`}
		>
			<label htmlFor={id} className="text-sm">
				{label}
			</label>
			<Switch id={id} checked={checked} onCheckedChange={onChange} />
		</div>
	)
}

function getThemeSelectLabel(
	value: string,
	t: ReturnType<typeof useIntl>,
): string {
	return value === "__none__" ? t("settings.themes.none") : value
}

function getStatsBadgeUnitLabel(
	value: EditorSettingsData["statsBadgeUnit"],
	t: ReturnType<typeof useIntl>,
): string {
	switch (value) {
		case "words":
			return t("settings.editor.statsBadge.words")
		case "sentences":
			return t("settings.editor.statsBadge.sentences")
		case "tasks":
			return t("settings.editor.statsBadge.tasks")
	}
}

function getStatsBadgeSelectValue(settings: EditorSettingsData): string {
	return settings.showStatsBadge ? settings.statsBadgeUnit : "hide"
}

function getStatsBadgeSelectLabel(
	settings: EditorSettingsData,
	t: ReturnType<typeof useIntl>,
): string {
	return settings.showStatsBadge
		? getStatsBadgeUnitLabel(settings.statsBadgeUnit, t)
		: t("settings.editor.statsBadge.hide")
}

function makeHandleStatsBadgeUnitChange(
	setSettings: (updates: Partial<EditorSettingsData>) => void,
) {
	return function handleStatsBadgeUnitChange(value: string | null) {
		if (value === "hide") {
			setSettings({ showStatsBadge: false })
			return
		}
		if (value === "words" || value === "sentences" || value === "tasks") {
			setSettings({ showStatsBadge: true, statsBadgeUnit: value })
		}
	}
}

function SyncNowSection() {
	let t = useIntl()
	let me = useAccount(UserAccount)
	let isOnline = useIsOnline()
	let [isSyncing, setIsSyncing] = useState(false)
	let [error, setError] = useState<string | null>(null)

	async function handleSyncNow() {
		if (!me.$isLoaded) return
		setIsSyncing(true)
		setError(null)
		try {
			await me.$jazz.waitForAllCoValuesSync({ timeout: 10000 })
		} catch {
			setError(t("settings.sync.syncTimeout"))
			setTimeout(() => setError(null), 5000)
		} finally {
			setIsSyncing(false)
		}
	}

	return (
		<Tooltip open={!!error}>
			<TooltipTrigger
				render={
					<Button
						onClick={handleSyncNow}
						variant="outline"
						size="sm"
						disabled={isSyncing || !me.$isLoaded || !isOnline}
					>
						<RefreshCw
							className={`mr-1.5 size-3.5 ${isSyncing ? "animate-spin" : ""}`}
						/>
						{isSyncing ? (
							<T k="settings.sync.syncing..." />
						) : (
							<T k="settings.sync.syncNow" />
						)}
					</Button>
				}
			/>
			<TooltipContent
				side="bottom"
				className="text-destructive bg-destructive/10"
			>
				{error}
			</TooltipContent>
		</Tooltip>
	)
}

function SignedInView() {
	let auth = usePassphraseAuth({ wordlist })
	let logOut = useLogOut()
	let isOnline = useIsOnline()
	let [showPassphrase, setShowPassphrase] = useState(false)
	let [isCopied, setIsCopied] = useState(false)

	async function handleCopy() {
		await navigator.clipboard.writeText(auth.passphrase)
		setIsCopied(true)
		setTimeout(() => setIsCopied(false), 2000)
	}

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				<T k="settings.sync.title" />
			</h2>
			<div className="bg-muted/30 rounded-lg p-4">
				{isOnline ? (
					<div className="mb-4 flex items-center gap-2 text-green-600 dark:text-green-400">
						<Cloud className="size-4" />
						<span className="flex-1 text-sm font-medium">
							<T k="settings.sync.syncing" />
						</span>
						<SyncNowSection />
					</div>
				) : (
					<div className="text-muted-foreground mb-4 flex items-center gap-2">
						<WifiOff className="size-4" />
						<span className="text-sm font-medium">
							<T k="settings.sync.offline" />
						</span>
					</div>
				)}
				<p className="text-muted-foreground mb-4 text-sm">
					{isOnline ? (
						<T k="settings.sync.notesSynced" />
					) : (
						<T k="settings.sync.offlineMessage" />
					)}
				</p>
				{showPassphrase ? (
					<>
						<div className="text-muted-foreground mb-2 text-xs">
							<T k="settings.sync.recoveryPhrase" />
						</div>
						<Textarea
							readOnly
							value={auth.passphrase}
							className="bg-background border-border mb-3 w-full resize-none rounded-md border p-3 font-mono text-sm"
							minRows={3}
						/>
						<div className="flex gap-2">
							<Button onClick={handleCopy} variant="outline" size="sm">
								{isCopied ? (
									<>
										<Check className="mr-1 size-3.5" />
										<T k="settings.sync.copied" />
									</>
								) : (
									<>
										<Copy className="mr-1 size-3.5" />
										<T k="settings.sync.copy" />
									</>
								)}
							</Button>
							<Button
								onClick={() => setShowPassphrase(false)}
								variant="ghost"
								size="sm"
							>
								<T k="settings.sync.hide" />
							</Button>
						</div>
					</>
				) : (
					<div className="flex gap-2">
						<Button
							onClick={() => setShowPassphrase(true)}
							variant="outline"
							size="sm"
						>
							<T k="settings.sync.showRecoveryPhrase" />
						</Button>
						<Button
							onClick={() => logOut()}
							variant="ghost"
							size="sm"
							data-testid={testIds.auth.settingsSignOut}
						>
							<T k="settings.sync.signOut" />
						</Button>
					</div>
				)}
			</div>
		</section>
	)
}

function InstallationSection() {
	let isPWAInstalled = useIsPWAInstalled()
	let [dialogOpen, setDialogOpen] = useState(false)

	if (isPWAInstalled) return null

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				<T k="settings.installation" />
			</h2>
			<div className="bg-muted/30 rounded-lg p-4">
				<div className="text-foreground mb-2 text-sm font-medium">
					<T k="settings.installation.notInstalled" />
				</div>
				<p className="text-muted-foreground mb-4 text-sm">
					<T k="settings.installation.installDescription" />
				</p>
				<Button onClick={() => setDialogOpen(true)} variant="outline" size="sm">
					<T k="settings.installation.showInstructions" />
				</Button>
			</div>
			<PWAInstallDialog open={dialogOpen} onOpenChange={setDialogOpen} />
		</section>
	)
}

function AppSection() {
	let { needRefresh, updateServiceWorker, checkForUpdates } = usePWA()
	let [isChecking, setIsChecking] = useState(false)

	async function handleCheckForUpdates() {
		setIsChecking(true)
		await checkForUpdates()
		setTimeout(() => setIsChecking(false), 1500)
	}

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				<T k="settings.app" />
			</h2>
			<div className="bg-muted/30 rounded-lg p-4">
				{needRefresh ? (
					<>
						<div className="text-foreground mb-2 text-sm font-medium">
							<T k="settings.app.updateAvailable" />
						</div>
						<p className="text-muted-foreground mb-4 text-sm">
							<T k="settings.app.newVersionReady" />
						</p>
						<Button onClick={updateServiceWorker} size="sm">
							<RefreshCw className="mr-1.5 size-3.5" />
							<T k="settings.app.reloadToUpdate" />
						</Button>
					</>
				) : (
					<>
						<div className="text-foreground mb-2 text-sm font-medium">
							<T k="settings.app.latestVersion" />
						</div>
						<p className="text-muted-foreground mb-4 text-sm">
							<T k="settings.app.noUpdates" />
						</p>
						<Button
							onClick={handleCheckForUpdates}
							variant="outline"
							size="sm"
							disabled={isChecking}
						>
							<RefreshCw
								className={`mr-1.5 size-3.5 ${isChecking ? "animate-spin" : ""}`}
							/>
							{isChecking ? (
								<T k="settings.app.checking" />
							) : (
								<T k="settings.app.checkForUpdates" />
							)}
						</Button>
					</>
				)}
			</div>
		</section>
	)
}

function ReloadDiagnosticsSection() {
	let [entries, setEntries] = useState(readReloadDiagnostics)
	let [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")
	let latest = entries.at(-1)

	async function handleCopy() {
		let copied = await copyText(reloadDiagnosticsReport())
		setCopyState(copied ? "copied" : "failed")
		setTimeout(() => setCopyState("idle"), 2000)
	}

	function handleClear() {
		clearReloadDiagnostics()
		setEntries([])
		setCopyState("idle")
	}

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				<T k="settings.reloadDiagnostics" />
			</h2>
			<div className="bg-muted/30 rounded-lg p-4">
				<p className="text-muted-foreground mb-4 text-sm">
					<T k="settings.reloadDiagnostics.description" />
				</p>
				<div className="bg-background border-border mb-4 rounded-md border p-3 font-mono text-xs">
					{latest ? (
						<>
							<div className="flex items-center justify-between gap-3">
								<span>{latest.event}</span>
								<span className="text-muted-foreground tabular-nums">
									{latest.elapsedMs} ms
								</span>
							</div>
							<div className="text-muted-foreground mt-1">{latest.at}</div>
							<div className="text-muted-foreground mt-1">
								{entries.length} events
							</div>
						</>
					) : (
						<T k="settings.reloadDiagnostics.empty" />
					)}
				</div>
				<div className="flex gap-2">
					<Button onClick={handleCopy} variant="outline" size="sm">
						{copyState === "copied" ? (
							<>
								<Check className="mr-1.5 size-3.5" />
								<T k="settings.reloadDiagnostics.copied" />
							</>
						) : copyState === "failed" ? (
							<>
								<AlertCircle className="mr-1.5 size-3.5" />
								<T k="settings.reloadDiagnostics.copyFailed" />
							</>
						) : (
							<>
								<Copy className="mr-1.5 size-3.5" />
								<T k="settings.reloadDiagnostics.copy" />
							</>
						)}
					</Button>
					<Button onClick={handleClear} variant="ghost" size="sm">
						<Trash2 className="mr-1.5 size-3.5" />
						<T k="settings.reloadDiagnostics.clear" />
					</Button>
				</div>
			</div>
		</section>
	)
}

async function copyText(value: string): Promise<boolean> {
	try {
		if (navigator.clipboard) {
			await navigator.clipboard.writeText(value)
			return true
		}
	} catch {
		// The selection fallback supports older standalone iOS web apps.
	}

	let textarea = document.createElement("textarea")
	textarea.value = value
	textarea.style.position = "fixed"
	textarea.style.opacity = "0"
	document.body.append(textarea)
	textarea.select()
	let copied = document.execCommand("copy")
	textarea.remove()
	return copied
}

function makeExportTheme(
	theme: co.loaded<typeof Theme, ThemeExportQuery>,
	setExporting: (id: string | null) => void,
) {
	return async function handleExport() {
		setExporting(theme.$jazz.id)
		try {
			await exportTheme(theme)
		} finally {
			setExporting(null)
		}
	}
}
