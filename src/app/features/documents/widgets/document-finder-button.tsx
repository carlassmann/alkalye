import { Search } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import { useIntl } from "@/shared/intl/setup"

export { DocumentFinderButton }

function DocumentFinderButton({ onClick }: { onClick: () => void }) {
	let t = useIntl()
	let label = t("editor.navigation.findDocument")

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						size="icon-sm"
						variant="ghost"
						aria-label={label}
						onClick={onClick}
						nativeButton
					>
						<Search className="size-4" />
					</Button>
				}
			/>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	)
}
