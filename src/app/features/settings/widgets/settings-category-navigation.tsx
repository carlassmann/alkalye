import {
	HardDrive,
	PenLine,
	PlugZap,
	SlidersHorizontal,
	type LucideIcon,
} from "lucide-react"
import { Button } from "@/app/components/ui/button"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select"
import { useIntl } from "@/shared/intl/setup"

export {
	SettingsCategoryNavigation,
	SettingsCategoryPicker,
	type SettingsCategory,
}

type SettingsCategory = "general" | "editor" | "connections" | "app"

interface SettingsCategoryItem {
	id: SettingsCategory
	label: string
	icon: LucideIcon
}

interface SettingsCategoryControlProps {
	category: SettingsCategory
	onCategoryChange(category: SettingsCategory): void
}

function useSettingsCategories(): SettingsCategoryItem[] {
	let t = useIntl()
	return [
		{
			id: "general",
			label: t("settings.category.general"),
			icon: SlidersHorizontal,
		},
		{
			id: "editor",
			label: t("settings.category.editor"),
			icon: PenLine,
		},
		{
			id: "connections",
			label: t("settings.category.connections"),
			icon: PlugZap,
		},
		{
			id: "app",
			label: t("settings.category.app"),
			icon: HardDrive,
		},
	]
}

function SettingsCategoryPicker({
	category,
	onCategoryChange,
}: SettingsCategoryControlProps) {
	let t = useIntl()
	let categories = useSettingsCategories()
	let activeCategory = categories.find(item => item.id === category)

	function handleChange(value: string | null) {
		if (
			value === "general" ||
			value === "editor" ||
			value === "connections" ||
			value === "app"
		) {
			onCategoryChange(value)
		}
	}

	return (
		<Select value={category} onValueChange={handleChange}>
			<SelectTrigger
				className="w-full text-base sm:text-xs md:hidden"
				aria-label={t("settings.categories")}
			>
				<SelectValue>{activeCategory?.label}</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{categories.map(item => (
					<SelectItem key={item.id} value={item.id}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

function SettingsCategoryNavigation({
	category,
	onCategoryChange,
}: SettingsCategoryControlProps) {
	let t = useIntl()
	let categories = useSettingsCategories()

	return (
		<nav
			aria-label={t("settings.categories")}
			className="sticky top-8 hidden space-y-1 md:block"
		>
			{categories.map(item => {
				let Icon = item.icon
				return (
					<Button
						key={item.id}
						type="button"
						variant="ghost"
						size="sm"
						data-current={item.id === category ? "" : undefined}
						aria-current={item.id === category ? "page" : undefined}
						className="text-muted-foreground data-current:bg-muted data-current:text-foreground w-full justify-start gap-2 px-3 font-normal"
						onClick={() => onCategoryChange(item.id)}
					>
						<Icon className="size-4" />
						{item.label}
					</Button>
				)
			})}
		</nav>
	)
}
