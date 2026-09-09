import { Check, CodeXml } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
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
	getContent,
	onThemeChange,
	disabled,
}: {
	getContent: () => string
	onThemeChange: (content: string) => void
	disabled?: boolean
}) {
	let content = getContent()
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
				<DropdownMenuItem onClick={() => selectTheme(null)}>
					<T k="editor.toolbar.useGlobalSyntaxTheme" />
					{!selectedFamilyId && <Check className="ml-auto" />}
				</DropdownMenuItem>
				{SYNTAX_THEME_FAMILIES.map(family => (
					<DropdownMenuItem
						key={family.id}
						onClick={() => selectTheme(family.id)}
					>
						{family.name}
						{selectedFamilyId === family.id && <Check className="ml-auto" />}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
