import { beforeEach, describe, expect, test, vi } from "vitest"
import {
	createJazzTestAccount,
	setActiveAccount,
	setupJazzTestSync,
} from "jazz-tools/testing"
import { AgentConnection, UserAccount } from "@/schema"
import { createPersonalDocument } from "@/app/features/documents"
import { reconcilePersonalDocumentAccess } from "./personal-document-access"

describe("personal document agent access", () => {
	beforeEach(async () => {
		await setupJazzTestSync()
	})

	test("applies one policy to current and future personal documents", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		let agent = await createJazzTestAccount({ AccountSchema: UserAccount })
		setActiveAccount(account)
		let connection = AgentConnection.create(
			{
				provider: "openai",
				accountId: agent.$jazz.id,
				credential: "wrapped-agent",
				createdAt: new Date(),
			},
			account.root.$jazz.owner,
		)
		let sendGrant = vi.fn().mockResolvedValue(Response.json({ ok: true }))
		vi.stubGlobal("fetch", sendGrant)

		let first = await createPersonalDocument(account, "First")
		await reconcilePersonalDocumentAccess(account, connection, "reader")
		expect(first.$jazz.owner.getRoleOf(agent.$jazz.id)).toBe("reader")

		let future = await createPersonalDocument(account, "Future")
		await reconcilePersonalDocumentAccess(account, connection, "reader")
		expect(future.$jazz.owner.getRoleOf(agent.$jazz.id)).toBe("reader")

		await reconcilePersonalDocumentAccess(account, connection, "writer")
		expect(first.$jazz.owner.getRoleOf(agent.$jazz.id)).toBe("writer")
		expect(future.$jazz.owner.getRoleOf(agent.$jazz.id)).toBe("writer")

		await reconcilePersonalDocumentAccess(account, connection, undefined)
		expect(first.$jazz.owner.getRoleOf(agent.$jazz.id)).toBeUndefined()
		expect(future.$jazz.owner.getRoleOf(agent.$jazz.id)).toBeUndefined()
		expect(sendGrant).toHaveBeenCalled()
		vi.unstubAllGlobals()
	})

	test("restores document access when the grant service rejects an update", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		let agent = await createJazzTestAccount({ AccountSchema: UserAccount })
		setActiveAccount(account)
		let connection = AgentConnection.create(
			{
				provider: "openai",
				accountId: agent.$jazz.id,
				credential: "wrapped-agent",
				createdAt: new Date(),
			},
			account.root.$jazz.owner,
		)
		let document = await createPersonalDocument(account, "Protected")
		document.$jazz.owner.addMember(agent, "reader")
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json({}, { status: 500 })),
		)

		await expect(
			reconcilePersonalDocumentAccess(account, connection, "writer"),
		).rejects.toThrow()
		expect(document.$jazz.owner.getRoleOf(agent.$jazz.id)).toBe("reader")
		vi.unstubAllGlobals()
	})
})
