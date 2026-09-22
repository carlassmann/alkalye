import { IconTransition } from "@/app/components/ui/icon-transition"
import { useState, useEffect, useSyncExternalStore } from "react"
import { useIntl } from "@/shared/intl/setup"
import { Sun, Moon, SunMoon } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "@/app/components/ui/dropdown-menu"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"

export { useTheme, useResolvedTheme, ThemeToggle, ThemeSubmenu, ThemeMenuItems }
export type { Theme }

type Theme = "light" | "dark" | "system"

// Apply theme immediately on load to prevent flash (browser only).
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
	applyTheme(getStoredTheme())
}

function useTheme() {
	let [theme, setThemeState] = useState<Theme>(getStoredTheme)

	function setTheme(newTheme: Theme) {
		localStorage.setItem("theme", newTheme)
		setThemeState(newTheme)
	}

	useEffect(() => {
		applyTheme(theme)

		if (theme === "system") {
			let mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
			let handler = () => applyTheme("system")
			mediaQuery.addEventListener("change", handler)
			return () => mediaQuery.removeEventListener("change", handler)
		}
	}, [theme])

	return { theme, setTheme }
}

function useResolvedTheme(): "light" | "dark" {
	let { theme } = useTheme()
	let systemPrefersDark = useSyncExternalStore(
		subscribeToSystemTheme,
		getSystemThemeSnapshot,
		() => false, // Server default
	)

	if (theme === "system") {
		return systemPrefersDark ? "dark" : "light"
	}
	return theme
}

interface ThemeToggleProps {
	theme: Theme
	setTheme: (theme: Theme) => void
	showLabel?: boolean
}

function ThemeToggle({ theme, setTheme, showLabel }: ThemeToggleProps) {
	let t = useIntl()
	let icon = (
		<IconTransition
			active={theme}
			icons={{ light: <Sun />, dark: <Moon />, system: <SunMoon /> }}
		/>
	)

	let trigger = showLabel ? (
		<Button
			variant="ghost"
			size="sm"
			aria-label={t("appearance.theme")}
			nativeButton
		>
			{icon}
			{t("appearance.theme")}
		</Button>
	) : (
		<Button
			variant="ghost"
			size="icon"
			aria-label={t("appearance.theme")}
			nativeButton
		>
			{icon}
		</Button>
	)

	return (
		<DropdownMenu>
			<Tooltip>
				<DropdownMenuTrigger render={<TooltipTrigger render={trigger} />} />
				<TooltipContent>{t("appearance.theme")}</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="center">
				<ThemeMenuItems theme={theme} setTheme={setTheme} />
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function ThemeSubmenu({ theme, setTheme }: ThemeToggleProps) {
	let t = useIntl()
	let icon = (
		<IconTransition
			active={theme}
			icons={{ light: <Sun />, dark: <Moon />, system: <SunMoon /> }}
		/>
	)

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				{icon}
				{t("appearance.theme")}
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent>
				<ThemeMenuItems theme={theme} setTheme={setTheme} />
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	)
}

function ThemeMenuItems({ theme, setTheme }: ThemeToggleProps) {
	let t = useIntl()
	return (
		<DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
			<DropdownMenuRadioItem value="light">
				<Sun /> {t("appearance.light")}
			</DropdownMenuRadioItem>
			<DropdownMenuRadioItem value="dark">
				<Moon /> {t("appearance.dark")}
			</DropdownMenuRadioItem>
			<DropdownMenuRadioItem value="system">
				<SunMoon /> {t("appearance.system")}
			</DropdownMenuRadioItem>
		</DropdownMenuRadioGroup>
	)
}

function getStoredTheme(): Theme {
	let stored = localStorage.getItem("theme")
	if (stored === "light" || stored === "dark" || stored === "system") {
		return stored
	}
	return "system"
}

function applyTheme(theme: Theme) {
	let root = document.documentElement
	if (theme === "system") {
		let prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
		root.classList.toggle("dark", prefersDark)
	} else {
		root.classList.toggle("dark", theme === "dark")
	}
}

function subscribeToSystemTheme(callback: () => void) {
	let mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
	mediaQuery.addEventListener("change", callback)
	return () => mediaQuery.removeEventListener("change", callback)
}

function getSystemThemeSnapshot() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
}
