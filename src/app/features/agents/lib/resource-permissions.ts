import { co, type Group } from "jazz-tools"
import { UserAccount } from "@/schema"

export { canAdministerGroup }

function canAdministerGroup(
	group: Group,
	account: co.loaded<typeof UserAccount>,
) {
	return group.getRoleOf(account.$jazz.id) === "admin"
}
