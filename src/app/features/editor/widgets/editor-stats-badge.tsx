import { useEditorStatistics } from "../hooks/use-editor-statistics"
import type { co } from "jazz-tools"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import { useSidebar } from "@/app/components/ui/sidebar"
import { Badge } from "@/app/components/ui/badge"
import { DEFAULT_EDITOR_SETTINGS, Settings } from "@/schema"
import { useIntl, T } from "@/shared/intl/setup"

export { EditorStatsBadge }

type StatsUnit = "words" | "sentences" | "tasks"
type SettingsCoMap = co.loaded<typeof Settings>
type EditorSettings = NonNullable<SettingsCoMap["editor"]>

interface EditorStatsBadgeProps {
	editor: Parameters<typeof useEditorStatistics>[0]
	selectionCount?: number
	settings: SettingsCoMap | null | undefined
}

function EditorStatsBadge({
	editor,
	settings,
	selectionCount = 1,
}: EditorStatsBadgeProps) {
	let t = useIntl()
	let { leftOpen, isMobile } = useSidebar()
	let editorSettings = { ...DEFAULT_EDITOR_SETTINGS, ...settings?.editor }
	let stats = useEditorStatistics(editor, editorSettings.showStatsBadge)
	let unitLabels: { value: StatsUnit; label: string }[] = [
		{ value: "words", label: t("editor.stats.words") },
		{ value: "sentences", label: t("editor.stats.sentences") },
		{ value: "tasks", label: t("editor.stats.tasks") },
	]

	if (!editorSettings.showStatsBadge && selectionCount < 2) return null

	return (
		<div
			className="absolute z-10 transition-[left] duration-200 ease-in"
			style={{
				bottom: "calc(0.75rem + env(safe-area-inset-bottom))",
				left:
					leftOpen && !isMobile
						? "calc(var(--left-sidebar-width) + 0.75rem)"
						: "0.75rem",
			}}
		>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Badge
							variant="outline"
							className="bg-background rounded-none select-none"
						>
							{selectionCount > 1
								? t("editor.stats.selections", { count: `${selectionCount}` })
								: formatStat(editorSettings.statsBadgeUnit, stats, t)}
						</Badge>
					}
				/>
				<DropdownMenuContent align="start" side="top">
					<DropdownMenuRadioGroup
						value={editorSettings.statsBadgeUnit}
						onValueChange={value => {
							if (!isStatsUnit(value)) return
							updateEditorSettings(settings, { statsBadgeUnit: value })
						}}
					>
						{unitLabels.map(({ value, label }) => (
							<DropdownMenuRadioItem
								key={value}
								value={value}
								className="justify-between gap-4"
							>
								<span>{label}</span>
								<span className="text-muted-foreground tabular-nums">
									{formatMenuStat(value, stats)}
								</span>
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() =>
							updateEditorSettings(settings, { showStatsBadge: false })
						}
						className="flex-col items-start gap-1"
					>
						<span>
							<T k="editor.stats.hideBadge" />
						</span>
						<span className="text-muted-foreground text-[11px]">
							<T k="editor.stats.hideHint" />
						</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}

function updateEditorSettings(
	settings: SettingsCoMap | null | undefined,
	updates: Partial<EditorSettings>,
) {
	if (!settings) return
	settings.$jazz.set("editor", {
		...DEFAULT_EDITOR_SETTINGS,
		...settings.editor,
		...updates,
	})
}

function isStatsUnit(value: string): value is StatsUnit {
	return value === "words" || value === "sentences" || value === "tasks"
}

function formatMenuStat(
	unit: StatsUnit,
	stats: Record<StatsUnit, string>,
): string {
	return stats[unit]
}

function formatStat(
	unit: StatsUnit,
	stats: Record<StatsUnit, string>,
	t: ReturnType<typeof useIntl>,
): string {
	switch (unit) {
		case "words":
			return `${stats.words} ${t("editor.stats.words").toLowerCase()}`
		case "sentences":
			return `${stats.sentences} ${t("editor.stats.sentences").toLowerCase()}`
		case "tasks":
			return `${stats.tasks} ${t("editor.stats.tasks").toLowerCase()}`
	}
}
