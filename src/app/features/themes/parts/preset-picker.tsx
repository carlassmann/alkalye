import { useState } from "react"
import { useAccount } from "jazz-tools/react"
import { co } from "jazz-tools"
import { Button } from "@/app/components/ui/button"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
	DropdownMenuLabel,
	DropdownMenuGroup,
} from "@/app/components/ui/dropdown-menu"
import { Paintbrush, Check, Sun, Moon } from "lucide-react"
import { UserAccount } from "@/schema"
import { parseFrontmatter, setPreset } from "@/app/features/editor"
import { Theme } from "../lib/schema"
import { getThemePresets, type ThemePresetType } from "../lib/document-theme"

export { PresetPicker }

type LoadedTheme = co.loaded<typeof Theme>

interface PresetPickerProps {
	getContent: () => string
	onPresetChange: (newContent: string) => void
	disabled?: boolean
}

function PresetPicker({
	getContent,
	onPresetChange,
	disabled,
}: PresetPickerProps) {
	let [open, setOpen] = useState(false)
	let content = getContent()
	let me = useAccount(UserAccount, { resolve: themesResolve })

	let themes: LoadedTheme[] = []
	if (me.$isLoaded && me.root?.themes?.$isLoaded) {
		themes = Array.from(me.root.themes).filter(
			(t): t is LoadedTheme => t?.$isLoaded === true,
		)
	}

	let { frontmatter } = parseFrontmatter(content)
	let currentThemeName = frontmatter?.theme as string | undefined
	let currentPresetName = frontmatter?.preset as string | undefined

	let currentTheme = currentThemeName
		? themes.find(t => t.name.toLowerCase() === currentThemeName.toLowerCase())
		: null

	// Get presets from current theme
	let presets: ThemePresetType[] = currentTheme
		? getThemePresets(currentTheme)
		: []

	// Only show preset picker for slideshow themes with presets
	let isSlideshowTheme =
		currentTheme?.type === "slideshow" || currentTheme?.type === "both"
	let hasPresets = presets.length > 0

	// Group presets by appearance
	let lightPresets = presets.filter(p => p.appearance === "light")
	let darkPresets = presets.filter(p => p.appearance === "dark")

	if (!isSlideshowTheme || !hasPresets) {
		return null
	}

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip>
				<DropdownMenuTrigger
					disabled={disabled}
					render={
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon"
									aria-label="Preset"
									className="shrink-0"
									nativeButton={false}
									disabled={disabled}
								>
									<Paintbrush />
								</Button>
							}
						/>
					}
				/>
				<TooltipContent>Select preset</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="center">
				{lightPresets.length > 0 && (
					<DropdownMenuGroup>
						<DropdownMenuLabel className="flex items-center gap-1.5">
							<Sun className="size-3.5" />
							Light
						</DropdownMenuLabel>
						{lightPresets.map(preset => (
							<PresetMenuItem
								key={preset.name}
								preset={preset}
								isSelected={
									currentPresetName?.toLowerCase() === preset.name.toLowerCase()
								}
								onSelect={() => {
									let newContent = setPreset(getContent(), preset.name)
									onPresetChange(newContent)
								}}
							/>
						))}
					</DropdownMenuGroup>
				)}
				{lightPresets.length > 0 && darkPresets.length > 0 && (
					<DropdownMenuSeparator />
				)}
				{darkPresets.length > 0 && (
					<DropdownMenuGroup>
						<DropdownMenuLabel className="flex items-center gap-1.5">
							<Moon className="size-3.5" />
							Dark
						</DropdownMenuLabel>
						{darkPresets.map(preset => (
							<PresetMenuItem
								key={preset.name}
								preset={preset}
								isSelected={
									currentPresetName?.toLowerCase() === preset.name.toLowerCase()
								}
								onSelect={() => {
									let newContent = setPreset(getContent(), preset.name)
									onPresetChange(newContent)
								}}
							/>
						))}
					</DropdownMenuGroup>
				)}
				{currentPresetName && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => {
								let newContent = setPreset(getContent(), null)
								onPresetChange(newContent)
							}}
						>
							Remove preset (use auto)
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function PresetMenuItem({
	preset,
	isSelected,
	onSelect,
}: {
	preset: ThemePresetType
	isSelected: boolean
	onSelect: () => void
}) {
	return (
		<DropdownMenuItem onClick={onSelect} className="flex items-center gap-2">
			<span
				className="size-3 shrink-0 rounded-sm border"
				style={{ backgroundColor: preset.colors.background }}
			/>
			{preset.name}
			{isSelected && <Check className="ml-auto size-4" />}
		</DropdownMenuItem>
	)
}

let themesResolve = {
	root: { themes: true },
} as const
