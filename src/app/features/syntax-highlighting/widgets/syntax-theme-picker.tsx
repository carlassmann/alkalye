import { CodeXml } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import {
	getSyntaxThemeFamilyId,
	setSyntaxTheme,
	SYNTAX_THEME_FAMILIES,
} from "../lib/syntax-highlighting"
import { T, useIntl } from "@/shared/intl/setup"

export { SyntaxThemePicker }

function SyntaxThemePicker({
	content,
	getContent,
	onThemeChange,
	disabled,
}: {
	content: string
	getContent: () => string
	onThemeChange: (content: string) => void
	disabled?: boolean
}) {
	let configuredFamilyId = getSyntaxThemeFamilyId(content)
	let selectedFamilyId = SYNTAX_THEME_FAMILIES.some(
		family => family.id === configuredFamilyId,
	)
		? configuredFamilyId
		: null
	let t = useIntl()

	function selectTheme(familyId: string | null) {
		onThemeChange(setSyntaxTheme(getContent(), familyId))
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
									aria-label={t("editor.toolbar.syntaxTheme")}
									nativeButton={false}
									disabled={disabled}
								>
									<CodeXml />
								</Button>
							}
						/>
					}
				/>
				<TooltipContent>
					<T k="editor.toolbar.syntaxTheme" />
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="center">
				<DropdownMenuRadioGroup
					value={selectedFamilyId ?? "global"}
					onValueChange={value =>
						selectTheme(value === "global" ? null : value)
					}
				>
					<DropdownMenuRadioItem value="global">
						<T k="editor.toolbar.useGlobalSyntaxTheme" />
					</DropdownMenuRadioItem>
					{SYNTAX_THEME_FAMILIES.map(family => (
						<DropdownMenuRadioItem key={family.id} value={family.id}>
							{family.name}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
