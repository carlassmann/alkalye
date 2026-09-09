import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { useAccount, Image } from "jazz-tools/react"
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
import { Palette, Check } from "lucide-react"
import { UserAccount } from "@/schema"
import { parseFrontmatter, setTheme } from "@/app/features/editor"
import { Theme } from "../lib/schema"

export { ThemePicker }

type LoadedTheme = co.loaded<
	typeof Theme,
	typeof themesResolve.root.themes.$each
>

interface ThemePickerProps {
	content: string
	getContent: () => string
	onThemeChange: (newContent: string) => void
	disabled?: boolean
}

function ThemePicker({
	content,
	getContent,
	onThemeChange,
	disabled,
}: ThemePickerProps) {
	let me = useAccount(UserAccount, { resolve: themesResolve })

	let themes: LoadedTheme[] = []
	if (me.$isLoaded && me.root?.themes?.$isLoaded) {
		themes = Array.from(me.root.themes).filter(
			(t): t is LoadedTheme => t?.$isLoaded === true,
		)
	}

	let { frontmatter } = parseFrontmatter(content)
	let currentThemeName = frontmatter?.theme as string | undefined

	// Filter themes by type - show preview and both types
	let previewThemes = themes.filter(
		t => t.type === "preview" || t.type === "both",
	)
	let slideshowThemes = themes.filter(
		t => t.type === "slideshow" || t.type === "both",
	)

	let hasThemes = themes.length > 0
	let selectedTheme = themes.find(theme =>
		isThemeSelected(currentThemeName, theme),
	)

	if (!hasThemes) {
		return null
	}

	return (
		<DropdownMenu>
			<Tooltip>
				<DropdownMenuTrigger
					disabled={disabled}
					render={
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon"
									aria-label="Theme"
									className="shrink-0"
									nativeButton={false}
									disabled={disabled}
								>
									<Palette />
								</Button>
							}
						/>
					}
				/>
				<TooltipContent>Select theme</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="center">
				{previewThemes.length > 0 && (
					<DropdownMenuGroup>
						<DropdownMenuLabel>Preview Themes</DropdownMenuLabel>
						{previewThemes.map(theme => (
							<ThemeMenuItem
								key={theme.$jazz.id}
								theme={theme}
								isSelected={isThemeSelected(currentThemeName, theme)}
								onSelect={() => {
									let newContent = setTheme(getContent(), theme.$jazz.id)
									onThemeChange(newContent)
								}}
							/>
						))}
					</DropdownMenuGroup>
				)}
				{previewThemes.length > 0 && slideshowThemes.length > 0 && (
					<DropdownMenuSeparator />
				)}
				{slideshowThemes.length > 0 && (
					<DropdownMenuGroup>
						<DropdownMenuLabel>Slideshow Themes</DropdownMenuLabel>
						{slideshowThemes.map(theme => (
							<ThemeMenuItem
								key={theme.$jazz.id}
								theme={theme}
								isSelected={isThemeSelected(currentThemeName, theme)}
								onSelect={() => {
									let newContent = setTheme(getContent(), theme.$jazz.id)
									onThemeChange(newContent)
								}}
							/>
						))}
					</DropdownMenuGroup>
				)}
				{currentThemeName && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => {
								let newContent = setTheme(getContent(), null)
								onThemeChange(newContent)
							}}
						>
							Remove theme
						</DropdownMenuItem>
					</>
				)}
				{selectedTheme?.sourceDocId && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							render={
								<Link
									to="/themes/$id/workbench"
									params={{ id: selectedTheme.$jazz.id }}
								/>
							}
						>
							Edit theme
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function isThemeSelected(
	themeReference: string | undefined,
	theme: LoadedTheme,
): boolean {
	if (!themeReference) return false
	return (
		themeReference === theme.$jazz.id ||
		themeReference.toLowerCase() === theme.name.toLowerCase()
	)
}

function ThemeMenuItem({
	theme,
	isSelected,
	onSelect,
}: {
	theme: LoadedTheme
	isSelected: boolean
	onSelect: () => void
}) {
	let [isHovered, setIsHovered] = useState(false)
	let thumbnailId = theme.thumbnail?.$jazz.id
	let hasPreviewContent = thumbnailId || theme.description

	return (
		<Tooltip open={hasPreviewContent ? isHovered : false}>
			<TooltipTrigger
				render={
					<DropdownMenuItem
						onClick={onSelect}
						onMouseEnter={() => setIsHovered(true)}
						onMouseLeave={() => setIsHovered(false)}
					>
						{theme.name}
						{isSelected && <Check className="ml-auto size-4" />}
					</DropdownMenuItem>
				}
			/>
			{hasPreviewContent && (
				<TooltipContent
					side="left"
					sideOffset={8}
					className="bg-popover text-popover-foreground ring-foreground/10 w-56 p-0 ring-1"
				>
					{thumbnailId && (
						<div className="bg-muted aspect-video w-full overflow-hidden">
							<Image imageId={thumbnailId} className="size-full object-cover" />
						</div>
					)}
					<div className="p-3">
						<div className="font-medium">{theme.name}</div>
						{theme.author && (
							<div className="text-muted-foreground text-xs">
								by {theme.author}
							</div>
						)}
						{theme.description && (
							<p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
								{theme.description}
							</p>
						)}
					</div>
				</TooltipContent>
			)}
		</Tooltip>
	)
}

let themesResolve = {
	root: { themes: { $each: { thumbnail: true } } },
} as const
