import { User, Check, Plus } from "lucide-react"
import { Link } from "@tanstack/react-router"
import { WorkspaceSelector } from "@/app/components/workspace-selector"
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@/app/components/ui/dropdown-menu"
import { testIds } from "@/app/lib/test-ids"
import { T, useIntl } from "@/shared/intl/setup"
export { SpaceSelector }
function SpaceSelector() {
	let t = useIntl()
	// v2-todo(spaces): query memberships and enable space creation.
	return (
		<WorkspaceSelector
			label={t("spaces.selector.personal")}
			icon={<User />}
			triggerTestId={testIds.space.selectorTrigger}
		>
			<DropdownMenuItem render={<Link to="/" search={{ personal: true }} />}>
				<User className="size-4" />
				<span>
					<T k="spaces.selector.personal" />
				</span>
				<Check className="ml-auto size-4" />
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem disabled>
				<Plus />
				<T k="spaces.selector.newSpace" />
			</DropdownMenuItem>
		</WorkspaceSelector>
	)
}
