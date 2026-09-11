import { beforeEach, describe, expect, test } from "vitest"
import { Group } from "jazz-tools"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { UserAccount } from "@/schema"
import { canAdministerGroup } from "./resource-permissions"

describe("agent resource permissions", () => {
	beforeEach(async () => {
		await setupJazzTestSync()
	})

	test("checks the displayed account instead of the group's ambient account", async () => {
		let admin = await createJazzTestAccount({ AccountSchema: UserAccount })
		let collaborator = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})
		let group = Group.create(admin)
		group.addMember(collaborator, "writer")

		expect(canAdministerGroup(group, admin)).toBe(true)
		expect(canAdministerGroup(group, collaborator)).toBe(false)
	})
})
