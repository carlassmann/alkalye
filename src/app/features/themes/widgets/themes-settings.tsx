import { useRef, useState } from "react"
import { useAll } from "jazz-tools/react"
import { Link } from "@tanstack/react-router"
import {
	app,
	useLibrary,
	type SettingsRow as SettingsData,
} from "@/app/features/documents"
import { useIntl, T } from "@/shared/intl/setup"
import { Button } from "@/app/components/ui/button"
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog"
import {
	SettingsSection,
	SettingsEmpty,
	SettingsPanel,
	SettingsActions,
	SettingsRow,
	SettingsGroupLabel,
} from "@/app/components/ui/settings-layout"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select"
import {
	AlertCircle,
	Palette,
	Pencil,
	Loader2,
	Download,
	Trash2,
	Plus,
	Upload,
} from "lucide-react"
import {
	parseThemeMarkdown,
	parseThemeZip,
	type ThemeUploadError,
} from "../lib/upload"
import { createTheme, createDefaultTheme } from "../lib/create"
import { exportTheme } from "../lib/export"
import type { ThemeRow } from "../lib/schema"
export { ThemesSection }
function ThemesSection() {
	let t = useIntl()
	let { db, ownerId, settings } = useLibrary()
	let { data: themes = [] } = useAll(app.themes.where({ ownerId }))
	let fileInputRef = useRef<HTMLInputElement>(null)
	let [isUploading, setIsUploading] = useState(false)
	let [uploadError, setUploadError] = useState<ThemeUploadError | null>(null)
	let [themeToDelete, setThemeToDelete] = useState<ThemeRow | null>(null)
	let [exportingThemeId, setExportingThemeId] = useState<string | null>(null)
	async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
		let file = event.target.files?.[0]
		event.target.value = ""
		if (!file) return
		setIsUploading(true)
		setUploadError(null)
		try {
			let result = file.name.endsWith(".md")
				? await parseThemeMarkdown(file)
				: await parseThemeZip(file)
			if (!result.ok) {
				setUploadError(result.error)
				return
			}
			await createTheme(db, ownerId, result.theme)
		} finally {
			setIsUploading(false)
		}
	}
	async function handleCreateTheme() {
		await createDefaultTheme(db, ownerId)
	}
	function handleDeleteTheme() {
		if (themeToDelete) void db.delete(app.themes, themeToDelete.id)
		setThemeToDelete(null)
	}
	function makeExportTheme(
		theme: ThemeRow,
		setExporting: (id: string | null) => void,
	) {
		return async () => {
			setExporting(theme.id)
			try {
				await exportTheme(db, theme)
			} finally {
				setExporting(null)
			}
		}
	}

	return (
		<SettingsSection
			title={<T k="settings.themes" />}
			description={<T k="settings.themes.description" />}
		>
			{uploadError && (
				<div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 border p-3 text-base/6 sm:text-sm/5">
					<AlertCircle className="mt-0.5 size-4 shrink-0" />
					<div className="min-w-0 flex-1">
						<div className="font-medium">{uploadError.message}</div>
						{"errors" in uploadError && uploadError.errors.length > 0 && (
							<ul className="mt-1 list-inside list-disc text-sm opacity-80 sm:text-xs">
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
						className="-mt-1 -mr-1 shrink-0"
						onClick={() => setUploadError(null)}
					>
						<span className="sr-only">
							<T k="settings.themes.dismiss" />
						</span>
						<span aria-hidden>×</span>
					</Button>
				</div>
			)}

			<SettingsPanel>
				{themes.length === 0 ? (
					<SettingsEmpty
						icon={<Palette className="size-8" />}
						title={<T k="settings.themes.noThemes" />}
						description={<T k="settings.themes.uploadHint" />}
					/>
				) : (
					<>
						{themes.map(theme => {
							if (!theme) return null
							return (
								<div
									key={theme.id}
									className="flex items-center gap-3 px-4 py-2.5"
								>
									<Palette className="text-muted-foreground size-4 shrink-0" />
									<div className="min-w-0 flex-1">
										<div className="truncate text-base font-medium sm:text-sm">
											{theme.name}
										</div>
										<div className="text-muted-foreground truncate text-sm sm:text-xs">
											{theme.type === "both"
												? t("settings.themes.previewAndSlideshow")
												: theme.type === "preview"
													? t("settings.themes.preview")
													: t("settings.themes.slideshow")}
											{theme.author &&
												` • ${t("settings.themes.by")} ${theme.author}`}
										</div>
									</div>
									{theme.sourceDocId && (
										<Button
											variant="ghost"
											size="icon-sm"
											nativeButton={false}
											render={
												<Link
													to="/themes/$id/workbench"
													params={{ id: theme.id }}
												/>
											}
											aria-label={`Edit ${theme.name} in workbench`}
										>
											<Pencil className="size-4" />
										</Button>
									)}
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={makeExportTheme(theme, setExportingThemeId)}
										disabled={exportingThemeId === theme.id}
										aria-label={`Export ${theme.name}`}
									>
										{exportingThemeId === theme.id ? (
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
						<DefaultThemeSettings settings={settings} themes={themes} />
					</>
				)}

				<SettingsActions>
					<input
						ref={fileInputRef}
						type="file"
						accept=".md,.theme.md,.zip"
						className="hidden"
						onChange={handleFileSelect}
					/>
					<Button onClick={handleCreateTheme} variant="outline" size="sm">
						<Plus className="mr-1.5 size-3.5" />
						<T k="settings.themes.newTheme" />
					</Button>
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
				</SettingsActions>
			</SettingsPanel>

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
		</SettingsSection>
	)
}

interface DefaultThemeSettingsProps {
	settings: SettingsData | undefined
	themes: ThemeRow[]
}
function DefaultThemeSettings({ settings, themes }: DefaultThemeSettingsProps) {
	let t = useIntl()
	let { db } = useLibrary()
	let loadedThemes = themes
	let previewThemes = loadedThemes.filter(
		t => t.type === "preview" || t.type === "both",
	)
	let slideshowThemes = loadedThemes.filter(
		t => t.type === "slideshow" || t.type === "both",
	)

	function handlePreviewThemeChange(value: string | null) {
		if (!settings || !value) return
		if (value === "__none__") {
			void db.update(app.settings, settings.id, { defaultPreviewTheme: null })
		} else {
			void db.update(app.settings, settings.id, { defaultPreviewTheme: value })
		}
	}

	function handleSlideshowThemeChange(value: string | null) {
		if (!settings || !value) return
		if (value === "__none__") {
			void db.update(app.settings, settings.id, { defaultSlideshowTheme: null })
		} else {
			void db.update(app.settings, settings.id, {
				defaultSlideshowTheme: value,
			})
		}
	}

	if (previewThemes.length === 0 && slideshowThemes.length === 0) {
		return null
	}

	return (
		<>
			<SettingsGroupLabel>
				<T k="settings.themes.defaultThemes" />
			</SettingsGroupLabel>
			{previewThemes.length > 0 && (
				<SettingsRow
					htmlFor="default-preview-theme"
					label={<T k="settings.themes.preview" />}
				>
					<Select
						value={settings?.defaultPreviewTheme ?? "__none__"}
						onValueChange={handlePreviewThemeChange}
					>
						<SelectTrigger id="default-preview-theme" className="w-40">
							<SelectValue>
								{themes.find(
									theme => theme.id === settings?.defaultPreviewTheme,
								)?.name ?? t("settings.themes.none")}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="__none__">
								<T k="settings.themes.none" />
							</SelectItem>
							{previewThemes.map(theme => (
								<SelectItem key={theme.id} value={theme.id}>
									{theme.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
			)}
			{slideshowThemes.length > 0 && (
				<SettingsRow
					htmlFor="default-slideshow-theme"
					label={<T k="settings.themes.slideshow" />}
				>
					<Select
						value={settings?.defaultSlideshowTheme ?? "__none__"}
						onValueChange={handleSlideshowThemeChange}
					>
						<SelectTrigger id="default-slideshow-theme" className="w-40">
							<SelectValue>
								{themes.find(
									theme => theme.id === settings?.defaultSlideshowTheme,
								)?.name ?? t("settings.themes.none")}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="__none__">
								<T k="settings.themes.none" />
							</SelectItem>
							{slideshowThemes.map(theme => (
								<SelectItem key={theme.id} value={theme.id}>
									{theme.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
			)}
		</>
	)
}
