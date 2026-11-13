import { AgentConnectionsSection } from "@/app/features/agents"
import { ThemesSection } from "@/app/features/themes"
import type { JazzClient } from "jazz-tools/client"
import { IconTransition } from "@/app/components/ui/icon-transition"
import { useState, useRef } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useJazzSession } from "jazz-tools/react"
import { RecoveryPhrase } from "jazz-tools/passphrase"
import {
	app,
	useLibrary,
	type SettingsRow as SettingsData,
} from "@/app/features/documents"
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
	Trash2,
	Loader2,
	AlertCircle,
	Sun,
	Moon,
	SunMoon,
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select"
import { useTheme } from "@/app/components/appearance"
import { AuthDialog, useIsBackedUp } from "@/app/features/auth"
import {
	useEditorSettings,
	DEFAULT_EDITOR_SETTINGS,
	type EditorSettingsData,
} from "@/app/features/editor"
import { Footer } from "@/app/components/footer"
import { usePWA, PWAInstallDialog } from "@/app/lib/pwa"
import { useIsPWAInstalled } from "@/app/lib/platform"
import {
	Tooltip,
	TooltipTrigger,
	TooltipContent,
} from "@/app/components/ui/tooltip"
import { useIsOnline } from "@/app/hooks/use-online"
import { SYNTAX_THEME_FAMILIES } from "@/app/features/syntax-highlighting"
import { testIds } from "@/app/lib/test-ids"
import {
	collectStorageDiagnostics,
	clearReloadDiagnostics,
	readReloadDiagnostics,
	reloadDiagnosticsReport,
} from "@/app/lib/reload-diagnostics"
import { useIntl, T } from "@/shared/intl/setup"
import { makeProfileNameSchema } from "../lib/profile-name"
import {
	SettingsCategoryNavigation,
	SettingsCategoryPicker,
	type SettingsCategory,
} from "../widgets/settings-category-navigation"
import {
	SettingsSection,
	SettingsPanel,
	SettingsRow,
	SettingsBlock,
	SettingsGroupLabel,
	SettingsStatus,
	SettingsActions,
} from "@/app/components/ui/settings-layout"

export { SettingsScreen }
interface SettingsSearch {
	from?: string
	oauth?: string
	category?: SettingsCategory
}

interface SettingsScreenProps {
	search: SettingsSearch
}

function SettingsScreen({ search }: SettingsScreenProps) {
	let t = useIntl()
	let navigate = useNavigate()
	let { theme, setTheme } = useTheme()
	let { from } = search
	let { settings } = useLibrary()
	let isAuthenticated = useIsBackedUp()
	let pageRef = useRef<HTMLDivElement>(null)
	let [announcedCategory, setAnnouncedCategory] = useState("")
	let [category, setCategory] = useState<SettingsCategory>(
		search.oauth ? "connections" : (search.category ?? "general"),
	)

	function handleCategoryChange(nextCategory: SettingsCategory) {
		setCategory(nextCategory)
		void navigate({
			to: "/settings",
			search: previous => ({ ...previous, category: nextCategory }),
			replace: true,
		})
		setAnnouncedCategory(categoryLabel(nextCategory, t))
		pageRef.current?.scrollTo({ top: 0 })
	}

	return (
		<>
			<title>{t("settings.title")}</title>
			<p className="sr-only" role="status" aria-live="polite">
				{announcedCategory}
			</p>
			<div
				ref={pageRef}
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
					<div className="flex w-full max-w-4xl items-center gap-3 px-4">
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
				<div className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
					<SettingsCategoryPicker
						category={category}
						onCategoryChange={handleCategoryChange}
					/>
					<div className="mt-6 grid items-start gap-8 md:mt-0 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10">
						<SettingsCategoryNavigation
							category={category}
							onCategoryChange={handleCategoryChange}
						/>
						<div id={`settings-${category}`} className="min-w-0 space-y-10">
							{category === "general" && (
								<>
									<ProfileSection />
									<SyncSection isAuthenticated={isAuthenticated} />
									<AppearanceSection theme={theme} setTheme={setTheme} />
								</>
							)}
							{category === "editor" && (
								<>
									<EditorSection settings={settings ?? null} />
									<ThemesSection />
								</>
							)}
							{category === "connections" && (
								<AgentConnectionsSection
									isAuthenticated={isAuthenticated}
									oauth={search.oauth}
								/>
							)}
							{category === "app" && (
								<>
									<InstallationSection />
									<AppSection />
									<ReloadDiagnosticsSection />
								</>
							)}
							<Footer />
						</div>
					</div>
				</div>
			</div>
		</>
	)
}

function categoryLabel(
	category: SettingsCategory,
	t: ReturnType<typeof useIntl>,
) {
	if (category === "general") return t("settings.category.general")
	if (category === "editor") return t("settings.category.editor")
	if (category === "connections") return t("settings.category.connections")
	return t("settings.category.app")
}

type AppTheme = ReturnType<typeof useTheme>["theme"]

interface AppearanceSectionProps {
	theme: AppTheme
	setTheme: (theme: AppTheme) => void
}

function AppearanceSection({ theme, setTheme }: AppearanceSectionProps) {
	let t = useIntl()

	function handleThemeChange(value: string | null) {
		if (value === "light" || value === "dark" || value === "system") {
			setTheme(value)
		}
	}

	return (
		<SettingsSection
			title={<T k="settings.appearance" />}
			description={<T k="settings.appearance.description" />}
		>
			<SettingsPanel>
				<SettingsRow htmlFor="theme" label={t("appearance.theme")}>
					<Select value={theme} onValueChange={handleThemeChange}>
						<SelectTrigger
							id="theme"
							className="w-40"
							aria-label={t("appearance.theme")}
						>
							<SelectValue>{t(`appearance.${theme}`)}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="light">
								<Sun className="size-4" /> {t("appearance.light")}
							</SelectItem>
							<SelectItem value="dark">
								<Moon className="size-4" /> {t("appearance.dark")}
							</SelectItem>
							<SelectItem value="system">
								<SunMoon className="size-4" /> {t("appearance.system")}
							</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
				<SyntaxThemeSetting />
				<LanguageSetting />
			</SettingsPanel>
		</SettingsSection>
	)
}

function SyntaxThemeSetting() {
	let { db, settings } = useLibrary()
	let t = useIntl()
	let selectedFamily = SYNTAX_THEME_FAMILIES.find(
		family => family.id === settings?.syntaxTheme,
	)
	let selectedFamilyId = selectedFamily?.id ?? "github"

	function handleChange(value: string | null) {
		if (!settings || !value) return
		db.update(app.settings, settings.id, {
			syntaxTheme: value === "github" ? null : value,
		})
	}

	return (
		<SettingsRow
			htmlFor="syntax-theme"
			label={<T k="settings.appearance.syntaxTheme" />}
		>
			<Select value={selectedFamilyId} onValueChange={handleChange}>
				<SelectTrigger
					id="syntax-theme"
					className="w-40"
					aria-label={t("settings.appearance.syntaxTheme")}
				>
					<SelectValue>{selectedFamily?.name ?? "GitHub"}</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{SYNTAX_THEME_FAMILIES.map(family => (
						<SelectItem key={family.id} value={family.id}>
							{family.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</SettingsRow>
	)
}

function makeNameSchema(t: ReturnType<typeof useIntl>) {
	return z.object({
		name: makeProfileNameSchema({
			required: t("settings.profile.nameRequired"),
			tooLong: t("settings.profile.nameTooLong"),
		}),
	})
}

function ProfileSection() {
	let { db, ownerId, profile } = useLibrary()
	let t = useIntl()
	let [dialogOpen, setDialogOpen] = useState(false)

	let name = profile?.name ?? t("common.anonymousUser")

	return (
		<SettingsSection
			title={<T k="settings.profile" />}
			description={<T k="settings.profile.description" />}
		>
			<SettingsPanel>
				<SettingsRow label={<T k="settings.profile.displayName" />}>
					<span className="truncate font-medium">{name}</span>
					<Button
						onClick={() => setDialogOpen(true)}
						variant="ghost"
						size="icon-sm"
						aria-label={t("settings.profile.editName")}
					>
						<Pencil className="size-4" />
					</Button>
				</SettingsRow>
			</SettingsPanel>
			<EditNameDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				currentName={profile?.name ?? ""}
				onSave={newName => {
					if (profile) db.update(app.profiles, profile.id, { name: newName })
					else db.insert(app.profiles, { ownerId, name: newName })
				}}
			/>
		</SettingsSection>
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

function LanguageSetting() {
	let { db, settings } = useLibrary()
	let t = useIntl()
	let currentLanguage = settings?.language || "en"

	function handleLanguageChange(value: string | null) {
		if (!settings) return
		if (value !== "en" && value !== "de") return
		db.update(app.settings, settings.id, { language: value })
	}

	return (
		<SettingsRow htmlFor="language" label={<T k="settings.language" />}>
			<Select value={currentLanguage} onValueChange={handleLanguageChange}>
				<SelectTrigger
					id="language"
					className="w-40"
					aria-label={t("settings.language")}
				>
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
		</SettingsRow>
	)
}

function SyncSection({ isAuthenticated }: { isAuthenticated: boolean }) {
	if (isAuthenticated) {
		return <SignedInView />
	}
	return <SignInView />
}

function SignInView() {
	let navigate = useNavigate()
	let [authOpen, setAuthOpen] = useState(false)

	return (
		<SettingsSection title={<T k="settings.sync.title" />}>
			<SettingsPanel>
				<SettingsStatus icon={<CloudOff className="size-4 shrink-0" />}>
					<T k="settings.sync.localOnly" />
				</SettingsStatus>
				<SettingsActions>
					<Button
						onClick={() => setAuthOpen(true)}
						size="sm"
						variant="outline"
						data-testid={testIds.auth.settingsSignIn}
					>
						<T k="settings.sync.signIn" />
					</Button>
				</SettingsActions>
			</SettingsPanel>
			<AuthDialog
				open={authOpen}
				onOpenChange={setAuthOpen}
				onSuccess={() => navigate({ to: "/" })}
			/>
		</SettingsSection>
	)
}

interface EditorSectionProps {
	settings: SettingsData | null
}

function EditorSection({ settings: jazzSettings }: EditorSectionProps) {
	let t = useIntl()
	let { settings, setSettings, resetSettings } = useEditorSettings(jazzSettings)

	return (
		<SettingsSection
			title={<T k="settings.editor" />}
			description={<T k="settings.editor.description" />}
			action={
				<Button
					variant="ghost"
					size="sm"
					onClick={resetSettings}
					className="text-muted-foreground"
				>
					<T k="settings.editor.resetDefaults" />
				</Button>
			}
		>
			<SettingsPanel>
				<SettingsGroupLabel>
					<T k="settings.editor.typography" />
				</SettingsGroupLabel>
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

				<SettingsGroupLabel>
					<T k="settings.editor.display" />
				</SettingsGroupLabel>
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
						settings.highlightCurrentLine ? "bg-foreground/5" : undefined
					}
				/>

				<ToggleSetting
					id="auto-sort-toggle"
					label={<T k="settings.editor.autoSortTasks" />}
					checked={settings.autoSortTasks}
					onChange={v => setSettings({ autoSortTasks: v })}
				/>

				<ToggleSetting
					id="spellcheck-toggle"
					label={<T k="settings.editor.spellcheck" />}
					checked={settings.spellcheck ?? true}
					onChange={v => setSettings({ spellcheck: v })}
				/>

				<SettingsRow
					htmlFor="spellcheck-language"
					label={<T k="settings.editor.spellcheckLanguage" />}
				>
					<Select
						value={settings.spellcheckLanguage || "system"}
						onValueChange={value => {
							if (value === "system" || value === "en" || value === "de") {
								setSettings({
									spellcheckLanguage: value === "system" ? "" : value,
								})
							}
						}}
					>
						<SelectTrigger id="spellcheck-language" className="w-40">
							<SelectValue>
								{spellcheckLanguageLabel(settings.spellcheckLanguage, t)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="system">
								<T k="settings.editor.spellcheckLanguage.system" />
							</SelectItem>
							<SelectItem value="en">
								<T k="settings.editor.spellcheckLanguage.english" />
							</SelectItem>
							<SelectItem value="de">
								<T k="settings.editor.spellcheckLanguage.german" />
							</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>

				<SettingsRow
					htmlFor="stats-badge-unit"
					label={<T k="settings.editor.statsBadge" />}
				>
					<Select
						value={getStatsBadgeSelectValue(settings)}
						onValueChange={makeHandleStatsBadgeUnitChange(setSettings)}
					>
						<SelectTrigger id="stats-badge-unit" className="w-40">
							<SelectValue>{getStatsBadgeSelectLabel(settings, t)}</SelectValue>
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
				</SettingsRow>

				<SettingsGroupLabel>
					<T k="settings.editor.behavior" />
				</SettingsGroupLabel>
				<ToggleSetting
					id="smart-pairs-toggle"
					label={<T k="settings.editor.smartPairs" />}
					checked={settings.smartPairs ?? true}
					onChange={value => setSettings({ smartPairs: value })}
				/>
				<ToggleSetting
					id="marker-wrapping-toggle"
					label={<T k="settings.editor.markerWrapping" />}
					checked={settings.markerWrapping ?? true}
					onChange={value => setSettings({ markerWrapping: value })}
				/>
				<ToggleSetting
					id="tab-indent-toggle"
					label={<T k="settings.editor.tabIndent" />}
					checked={settings.tabIndent ?? true}
					onChange={value => setSettings({ tabIndent: value })}
				/>
				<ToggleSetting
					id="smart-paste-toggle"
					label={<T k="settings.editor.smartPaste" />}
					checked={settings.smartPaste ?? true}
					onChange={value => setSettings({ smartPaste: value })}
				/>
				<ToggleSetting
					id="autocomplete-toggle"
					label={<T k="settings.editor.autocomplete" />}
					checked={settings.autocomplete ?? true}
					onChange={value => setSettings({ autocomplete: value })}
				/>
			</SettingsPanel>
		</SettingsSection>
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
		<SettingsRow
			label={label}
			description={
				isDefault
					? undefined
					: t("settings.numericDefault", {
							value: `${defaultValue.toFixed(decimals)}${unit}`,
						})
			}
		>
			<span className="text-muted-foreground w-6 text-right text-sm sm:text-xs">
				{unit}
			</span>
			<div className="border-input focus-within:border-ring flex h-9 items-stretch border sm:h-8">
				<Button
					variant="ghost"
					onClick={decrement}
					disabled={value <= min}
					aria-label={t("settings.numericDecrease", { label })}
					className="h-auto w-9 rounded-none p-0 sm:w-8"
				>
					<Minus className="size-3" />
				</Button>
				<Input
					type="number"
					aria-label={label}
					value={value.toFixed(decimals)}
					onChange={handleInputChange}
					step={step}
					className="border-input h-auto w-14 [appearance:textfield] rounded-none border-x border-y-0 bg-transparent px-0 text-center text-base tabular-nums focus-visible:ring-0 sm:text-sm dark:bg-transparent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				/>
				<Button
					variant="ghost"
					onClick={increment}
					disabled={value >= max}
					aria-label={t("settings.numericIncrease", { label })}
					className="h-auto w-9 rounded-none p-0 sm:w-8"
				>
					<Plus className="size-3" />
				</Button>
			</div>
		</SettingsRow>
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
		<SettingsRow label={label} labelId={`${id}-label`} className={className}>
			<Switch
				id={id}
				aria-labelledby={`${id}-label`}
				checked={checked}
				onCheckedChange={onChange}
			/>
		</SettingsRow>
	)
}

function spellcheckLanguageLabel(
	value: string | undefined,
	t: ReturnType<typeof useIntl>,
): string {
	if (value === "en") return t("settings.editor.spellcheckLanguage.english")
	if (value === "de") return t("settings.editor.spellcheckLanguage.german")
	return t("settings.editor.spellcheckLanguage.system")
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
	let { db } = useLibrary()
	let isOnline = useIsOnline()
	let [isSyncing, setIsSyncing] = useState(false)
	let [error, setError] = useState<string | null>(null)

	async function handleSyncNow() {
		setIsSyncing(true)
		setError(null)
		try {
			await db.waitForSync()
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
						disabled={isSyncing || !isOnline}
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
	let auth = useJazzSession<JazzClient>()
	let passphrase = RecoveryPhrase.fromSecret(auth.exportDeviceKey())
	let logOut = async () => {
		await auth.signOut()
		await auth.createDeviceAccount()
	}
	let isOnline = useIsOnline()
	let [showPassphrase, setShowPassphrase] = useState(false)
	let [isCopied, setIsCopied] = useState(false)

	async function handleCopy() {
		await navigator.clipboard.writeText(passphrase)
		setIsCopied(true)
		setTimeout(() => setIsCopied(false), 2000)
	}

	return (
		<SettingsSection title={<T k="settings.sync.title" />}>
			<SettingsPanel>
				{isOnline ? (
					<SettingsStatus
						tone="ok"
						icon={<Cloud className="size-4 shrink-0" />}
						action={<SyncNowSection />}
						description={<T k="settings.sync.notesSynced" />}
					>
						<T k="settings.sync.syncing" />
					</SettingsStatus>
				) : (
					<SettingsStatus
						icon={<WifiOff className="size-4 shrink-0" />}
						description={<T k="settings.sync.offlineMessage" />}
					>
						<T k="settings.sync.offline" />
					</SettingsStatus>
				)}
				{showPassphrase ? (
					<>
						<SettingsBlock className="space-y-2">
							<div className="text-muted-foreground text-sm sm:text-xs">
								<T k="settings.sync.recoveryPhrase" />
							</div>
							<Textarea
								readOnly
								value={passphrase}
								data-syntwin-hidden
								className="bg-background border-border w-full resize-none border p-3 font-mono text-base/6 sm:text-sm/5"
								minRows={3}
							/>
						</SettingsBlock>
						<SettingsActions>
							<Button onClick={handleCopy} variant="outline" size="sm">
								<IconTransition
									active={isCopied ? "copied" : "copy"}
									icons={{
										copied: <Check className="size-3.5" />,
										copy: <Copy className="size-3.5" />,
									}}
									className="mr-1 size-3.5"
								/>
								{isCopied ? (
									<T k="settings.sync.copied" />
								) : (
									<T k="settings.sync.copy" />
								)}
							</Button>
							<Button
								onClick={() => setShowPassphrase(false)}
								variant="ghost"
								size="sm"
							>
								<T k="settings.sync.hide" />
							</Button>
						</SettingsActions>
					</>
				) : (
					<SettingsActions>
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
					</SettingsActions>
				)}
			</SettingsPanel>
		</SettingsSection>
	)
}

function InstallationSection() {
	let isPWAInstalled = useIsPWAInstalled()
	let [dialogOpen, setDialogOpen] = useState(false)

	if (isPWAInstalled) return null

	return (
		<SettingsSection title={<T k="settings.installation" />}>
			<SettingsPanel>
				<SettingsStatus
					description={<T k="settings.installation.installDescription" />}
				>
					<T k="settings.installation.notInstalled" />
				</SettingsStatus>
				<SettingsActions>
					<Button
						onClick={() => setDialogOpen(true)}
						variant="outline"
						size="sm"
					>
						<T k="settings.installation.showInstructions" />
					</Button>
				</SettingsActions>
			</SettingsPanel>
			<PWAInstallDialog open={dialogOpen} onOpenChange={setDialogOpen} />
		</SettingsSection>
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
		<SettingsSection title={<T k="settings.app" />}>
			<SettingsPanel>
				{needRefresh ? (
					<>
						<SettingsStatus
							tone="ok"
							description={<T k="settings.app.newVersionReady" />}
						>
							<T k="settings.app.updateAvailable" />
						</SettingsStatus>
						<SettingsActions>
							<Button onClick={updateServiceWorker} size="sm">
								<RefreshCw className="mr-1.5 size-3.5" />
								<T k="settings.app.reloadToUpdate" />
							</Button>
							<Button
								variant="outline"
								size="sm"
								render={
									<a
										href="/changelog"
										target="_blank"
										rel="noopener noreferrer"
									/>
								}
							>
								<T k="settings.app.whatsNew" />
							</Button>
						</SettingsActions>
					</>
				) : (
					<>
						<SettingsStatus description={<T k="settings.app.noUpdates" />}>
							<T k="settings.app.latestVersion" />
						</SettingsStatus>
						<SettingsActions>
							<Button
								variant="outline"
								size="sm"
								render={
									<a
										href="/changelog"
										target="_blank"
										rel="noopener noreferrer"
									/>
								}
							>
								<T k="settings.app.whatsNew" />
							</Button>
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
						</SettingsActions>
					</>
				)}
			</SettingsPanel>
		</SettingsSection>
	)
}

function ReloadDiagnosticsSection() {
	let [entries, setEntries] = useState(readReloadDiagnostics)
	let [copyState, setCopyState] = useState<
		"idle" | "preparing" | "copied" | "failed"
	>("idle")
	let latest = entries.at(-1)

	async function handleCopy() {
		setCopyState("preparing")
		let { collectStartupDiagnosticLabels } =
			await import("../lib/startup-diagnostic-labels")
		let labels = await collectStartupDiagnosticLabels()
		await collectStorageDiagnostics(labels)
		setEntries(readReloadDiagnostics())
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
		<SettingsSection
			title={<T k="settings.reloadDiagnostics" />}
			description={<T k="settings.reloadDiagnostics.description" />}
		>
			<SettingsPanel>
				<SettingsBlock>
					<div className="bg-background border-border border p-3 font-mono text-sm sm:text-xs">
						{latest ? (
							<>
								<div className="flex items-center justify-between gap-3">
									<span className="truncate">{latest.event}</span>
									<span className="text-muted-foreground shrink-0 tabular-nums">
										{latest.elapsedMs} ms
									</span>
								</div>
								<div className="text-muted-foreground mt-1">{latest.at}</div>
								<div className="text-muted-foreground mt-1 tabular-nums">
									{entries.length} events
								</div>
							</>
						) : (
							<span className="text-muted-foreground">
								<T k="settings.reloadDiagnostics.empty" />
							</span>
						)}
					</div>
				</SettingsBlock>
				<SettingsActions>
					<Button
						onClick={handleCopy}
						variant="outline"
						size="sm"
						disabled={copyState === "preparing"}
						className="min-w-36"
					>
						<IconTransition
							active={copyState}
							icons={{
								idle: <Copy className="size-3.5" />,
								preparing: (
									<Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
								),
								copied: <Check className="size-3.5" />,
								failed: <AlertCircle className="size-3.5" />,
							}}
							className="mr-1.5 size-3.5"
						/>
						{copyState === "preparing" ? (
							<T k="settings.reloadDiagnostics.preparing" />
						) : copyState === "copied" ? (
							<T k="settings.reloadDiagnostics.copied" />
						) : copyState === "failed" ? (
							<T k="settings.reloadDiagnostics.copyFailed" />
						) : (
							<T k="settings.reloadDiagnostics.copy" />
						)}
					</Button>
					<Button
						onClick={handleClear}
						variant="ghost"
						size="sm"
						disabled={copyState === "preparing"}
					>
						<Trash2 className="mr-1.5 size-3.5" />
						<T k="settings.reloadDiagnostics.clear" />
					</Button>
				</SettingsActions>
			</SettingsPanel>
		</SettingsSection>
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
