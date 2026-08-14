import { beforeEach, describe, expect, test } from "vitest"
import {
	createJazzTestAccount,
	setActiveAccount,
	setupJazzTestSync,
} from "jazz-tools/testing"
import { Group, co } from "jazz-tools"
import { Document, Space, UserAccount, UserRoot, createSpace } from "@/schema"
import { inspectRecovery, recoverAccount } from "./recovery"

function makeDoc(text: string) {
	let now = new Date()
	return Document.create(
		{
			version: 1,
			content: co.plainText().create(text),
			createdAt: now,
			updatedAt: now,
		},
		Group.create(),
	)
}

function makeFreshEmptyRoot() {
	return UserRoot.create({
		documents: co.list(Document).create([]),
		migrationVersion: 1,
	})
}

// createJazzTestAccount runs the account migration, which seeds a welcome doc.
// So a freshly seeded root already has: [welcome, projectDoc, groceryDoc].
async function seedAccount() {
	let account = await createJazzTestAccount({
		isCurrentActiveAccount: true,
		AccountSchema: UserAccount,
	})
	let { root } = await account.$jazz.ensureLoaded({
		resolve: {
			root: { documents: true, inactiveDocuments: true, spaces: true },
		},
	})

	let projectDoc = makeDoc("# Project notes\nline")
	let groceryDoc = makeDoc("# Grocery list\nmilk")
	root.documents.$jazz.push(projectDoc)
	root.documents.$jazz.push(groceryDoc)
	let space = createSpace("Team Space", root)

	return {
		account,
		root,
		projectDoc,
		projectDocId: projectDoc.$jazz.id,
		groceryDocId: groceryDoc.$jazz.id,
		spaceId: space.$jazz.id,
	}
}

describe("recovery - root pointer overwrite (damage mode a)", () => {
	beforeEach(async () => {
		await setupJazzTestSync()
	})

	test("inspect finds the previous root; recover restores it and merges post-incident docs", async () => {
		let {
			account,
			root: oldRoot,
			projectDocId,
			groceryDocId,
			spaceId,
		} = await seedAccount()
		let oldRootId = oldRoot.$jazz.id

		account.$jazz.set("root", makeFreshEmptyRoot())

		let { root: currentRoot } = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		let postIncidentDoc = makeDoc("# Written after the bug\nnew")
		currentRoot.documents.$jazz.push(postIncidentDoc)
		let postIncidentDocId = postIncidentDoc.$jazz.id

		let inspection = await inspectRecovery(account)
		let previousCandidate = inspection.rootCandidates.find(
			candidate => candidate.id === oldRootId,
		)
		expect(previousCandidate).toBeDefined()
		expect(previousCandidate?.isCurrent).toBe(false)
		expect(previousCandidate?.documents.count).toBe(3)
		expect(previousCandidate?.spaces.count).toBe(1)

		let outcome = await recoverAccount({ rootId: oldRootId })
		expect(outcome).toBe("recovered")

		let restored = await account.$jazz.ensureLoaded({
			resolve: {
				root: { documents: { $each: { content: true } }, spaces: true },
			},
		})
		expect(restored.root.$jazz.id).toBe(oldRootId)

		let restoredDocIds = restored.root.documents.map(doc => doc?.$jazz.id)
		expect(restoredDocIds).toContain(projectDocId)
		expect(restoredDocIds).toContain(groceryDocId)
		expect(restoredDocIds).toContain(postIncidentDocId)
		expect(restored.root.spaces?.some(s => s?.$jazz.id === spaceId)).toBe(true)
	})

	test("bare recover() only plans; confirm executes; a second bare recover() must not flip back", async () => {
		let { account, root: oldRoot } = await seedAccount()
		let oldRootId = oldRoot.$jazz.id

		let freshRoot = makeFreshEmptyRoot()
		account.$jazz.set("root", freshRoot)

		let planned = await recoverAccount()
		expect(planned).toBe("planned")
		expect(account.$jazz.raw.get("root")).toBe(freshRoot.$jazz.id)

		let recovered = await recoverAccount({ confirm: true })
		expect(recovered).toBe("recovered")
		expect(account.$jazz.raw.get("root")).toBe(oldRootId)

		let secondBare = await recoverAccount()
		expect(secondBare).toBe("noop")
		let secondConfirmed = await recoverAccount({ confirm: true })
		expect(secondConfirmed).toBe("noop")
		expect(account.$jazz.raw.get("root")).toBe(oldRootId)
	})

	test("recover() on a healthy account is a no-op", async () => {
		let { account, root } = await seedAccount()
		let rootId = root.$jazz.id
		let documentsId = root.documents.$jazz.id

		expect(await recoverAccount()).toBe("noop")
		expect(await recoverAccount({ confirm: true })).toBe("noop")

		expect(account.$jazz.raw.get("root")).toBe(rootId)
		let { root: after } = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		expect(after.documents.$jazz.id).toBe(documentsId)
	})

	test("settings and safe scalar keys survive a root recovery", async () => {
		let { account, root: oldRoot } = await seedAccount()
		let oldRootId = oldRoot.$jazz.id
		let oldSettingsId = oldRoot.$jazz.raw.get("settings")
		expect(typeof oldSettingsId).toBe("string")
		oldRoot.$jazz.set("migrationVersion", undefined)

		account.$jazz.set("root", makeFreshEmptyRoot())

		let { root: currentRoot } = await account.$jazz.ensureLoaded({
			resolve: { root: true },
		})
		currentRoot.$jazz.set("migrationVersion", 2)
		currentRoot.$jazz.set("language", "de")
		currentRoot.$jazz.set("lastOpenedDocId", "co_zSomeDocId")

		let outcome = await recoverAccount({ rootId: oldRootId })
		expect(outcome).toBe("recovered")

		let { root: restored } = await account.$jazz.ensureLoaded({
			resolve: { root: true },
		})
		expect(restored.$jazz.id).toBe(oldRootId)
		expect(restored.$jazz.raw.get("settings")).toBe(oldSettingsId)
		expect(restored.language).toBe("de")
		expect(restored.lastOpenedDocId).toBe("co_zSomeDocId")
		expect(restored.migrationVersion).toBeUndefined()
	})

	test("doc deleted on the current root is not resurrected as active by a root recovery", async () => {
		let {
			account,
			root: oldRoot,
			projectDoc,
			projectDocId,
		} = await seedAccount()
		let oldRootId = oldRoot.$jazz.id

		account.$jazz.set("root", makeFreshEmptyRoot())

		// The device still holds the doc locally: user deleted it post-incident,
		// so it sits in the current root's trash while the old root lists it
		// as active.
		projectDoc.$jazz.set("deletedAt", new Date())
		let { root: currentRoot } = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		currentRoot.$jazz.set(
			"inactiveDocuments",
			co.list(Document).create([projectDoc], currentRoot.$jazz.owner),
		)

		let outcome = await recoverAccount({ rootId: oldRootId })
		expect(outcome).toBe("recovered")

		let restored = await account.$jazz.ensureLoaded({
			resolve: {
				root: { documents: true, inactiveDocuments: true },
			},
		})
		let activeIds = restored.root.documents.map(doc => doc?.$jazz.id)
		expect(activeIds).not.toContain(projectDocId)
		let inactiveIds = (restored.root.inactiveDocuments ?? []).map(
			doc => doc?.$jazz.id,
		)
		expect(inactiveIds.filter(id => id === projectDocId).length).toBe(1)
	})

	test("welcome doc created on the current root after the incident is skipped during merge", async () => {
		let { account, root: oldRoot } = await seedAccount()
		let oldRootId = oldRoot.$jazz.id
		let lengthBeforeIncident = oldRoot.documents.length

		account.$jazz.set("root", makeFreshEmptyRoot())

		let { root: currentRoot } = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		let postWelcomeDoc = makeDoc("# Welcome to Alkalye\nintro")
		currentRoot.documents.$jazz.push(postWelcomeDoc)

		let outcome = await recoverAccount({ rootId: oldRootId })
		expect(outcome).toBe("recovered")

		let restored = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		let restoredDocIds = restored.root.documents.map(doc => doc?.$jazz.id)
		expect(restoredDocIds).not.toContain(postWelcomeDoc.$jazz.id)
		expect(restored.root.documents.length).toBe(lengthBeforeIncident)
	})

	test("rootId outside the account's edit history is refused unless forced", async () => {
		let { account, root } = await seedAccount()
		let realRootId = root.$jazz.id

		account.$jazz.set("root", makeFreshEmptyRoot())

		let foreignRoot = makeFreshEmptyRoot()
		let outcome = await recoverAccount({ rootId: foreignRoot.$jazz.id })
		expect(outcome).toBe("refused")
		expect(account.$jazz.raw.get("root")).not.toBe(foreignRoot.$jazz.id)

		let recovered = await recoverAccount({ rootId: realRootId })
		expect(recovered).toBe("recovered")
		expect(account.$jazz.raw.get("root")).toBe(realRootId)
	})

	test("older-than-newest root candidate is refused unless forced", async () => {
		let { account, root: oldestRoot } = await seedAccount()
		let oldestRootId = oldestRoot.$jazz.id

		let middleRoot = makeFreshEmptyRoot()
		account.$jazz.set("root", middleRoot)
		let latestRoot = makeFreshEmptyRoot()
		account.$jazz.set("root", latestRoot)

		let outcome = await recoverAccount({ rootId: oldestRootId })
		expect(outcome).toBe("refused")
		expect(account.$jazz.raw.get("root")).toBe(latestRoot.$jazz.id)

		let forced = await recoverAccount({ rootId: oldestRootId, force: true })
		expect(forced).toBe("recovered")
		expect(account.$jazz.raw.get("root")).toBe(oldestRootId)
	})

	test("edited welcome doc survives the merge when the restored root has no welcome doc", async () => {
		let { account, root: oldRoot } = await seedAccount()
		let oldRootId = oldRoot.$jazz.id

		let seededWelcomeIndex = oldRoot.documents.findIndex(doc => {
			if (!doc?.$isLoaded || !doc.content?.$isLoaded) return false
			return doc.content.toString().startsWith("# Welcome to Alkalye")
		})
		expect(seededWelcomeIndex).toBeGreaterThanOrEqual(0)
		oldRoot.documents.$jazz.splice(seededWelcomeIndex, 1)

		account.$jazz.set("root", makeFreshEmptyRoot())

		let { root: currentRoot } = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		let editedWelcome = makeDoc("# Welcome to Alkalye\nmy important additions")
		currentRoot.documents.$jazz.push(editedWelcome)

		let outcome = await recoverAccount({ rootId: oldRootId })
		expect(outcome).toBe("recovered")

		let restored = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		let restoredDocIds = restored.root.documents.map(doc => doc?.$jazz.id)
		expect(restoredDocIds).toContain(editedWelcome.$jazz.id)
	})
})

describe("recovery - list pointer overwrite (damage mode b)", () => {
	beforeEach(async () => {
		await setupJazzTestSync()
	})

	test("inspect finds previous list pointers; recover restores docs and spaces with merge", async () => {
		let { account, root, projectDocId, groceryDocId, spaceId } =
			await seedAccount()
		let oldDocumentsId = root.documents.$jazz.id
		let oldSpacesId = root.spaces?.$jazz.id
		let docsCountBeforeIncident = root.documents.length

		root.$jazz.set("documents", co.list(Document).create([], root.$jazz.owner))
		root.$jazz.set("spaces", co.list(Space).create([], root.$jazz.owner))

		let { root: currentRoot } = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		let postIncidentDoc = makeDoc("# Made after incident\nnew")
		currentRoot.documents.$jazz.push(postIncidentDoc)
		let postIncidentDocId = postIncidentDoc.$jazz.id

		let inspection = await inspectRecovery(account)
		let documentsHistory = inspection.currentRootLists.documents
		expect(documentsHistory?.some(c => c.id === oldDocumentsId)).toBe(true)
		let oldDocsCandidate = documentsHistory?.find(c => c.id === oldDocumentsId)
		expect(oldDocsCandidate?.isCurrent).toBe(false)

		let outcome = await recoverAccount({
			documents: oldDocumentsId,
			spaces: oldSpacesId,
		})
		expect(outcome).toBe("recovered")

		let restored = await account.$jazz.ensureLoaded({
			resolve: {
				root: { documents: { $each: { content: true } }, spaces: true },
			},
		})
		expect(restored.root.documents.$jazz.id).toBe(oldDocumentsId)
		let ids = restored.root.documents.map(doc => doc?.$jazz.id)
		expect(ids).toContain(projectDocId)
		expect(ids).toContain(groceryDocId)
		expect(ids).toContain(postIncidentDocId)
		expect(restored.root.documents.length).toBe(docsCountBeforeIncident + 1)
		expect(restored.root.spaces?.$jazz.id).toBe(oldSpacesId)
		expect(restored.root.spaces?.some(s => s?.$jazz.id === spaceId)).toBe(true)
	})

	test("deleted doc in the old documents list is not resurrected as active", async () => {
		let { account, root, projectDoc, projectDocId, groceryDocId } =
			await seedAccount()
		let oldDocumentsId = root.documents.$jazz.id

		// Deletion state lives on the (unclobbered) inactive list: the doc is
		// flagged and trashed, while the stale old documents list still holds it.
		projectDoc.$jazz.set("deletedAt", new Date())
		root.inactiveDocuments?.$jazz.push(projectDoc)

		root.$jazz.set("documents", co.list(Document).create([], root.$jazz.owner))

		let outcome = await recoverAccount({ documents: oldDocumentsId })
		expect(outcome).toBe("recovered")

		let restored = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true, inactiveDocuments: true } },
		})
		let activeIds = restored.root.documents.map(doc => doc?.$jazz.id)
		expect(activeIds).not.toContain(projectDocId)
		expect(activeIds).toContain(groceryDocId)
		let inactiveIds = (restored.root.inactiveDocuments ?? []).map(
			doc => doc?.$jazz.id,
		)
		expect(inactiveIds.filter(id => id === projectDocId).length).toBe(1)
	})

	test("list id outside the root's edit history is refused unless forced", async () => {
		let { account, root } = await seedAccount()

		root.$jazz.set("documents", co.list(Document).create([], root.$jazz.owner))

		let foreignList = co.list(Document).create([makeDoc("# Foreign\nx")])
		let outcome = await recoverAccount({ documents: foreignList.$jazz.id })
		expect(outcome).toBe("refused")

		let { root: after } = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		expect(after.documents.$jazz.id).not.toBe(foreignList.$jazz.id)
	})

	test("a mid-run load failure refuses the whole recovery without partial writes", async () => {
		let { account, root } = await seedAccount()
		let oldDocumentsId = root.documents.$jazz.id
		let oldDocsCountBefore = root.documents.length

		root.$jazz.set("documents", co.list(Document).create([], root.$jazz.owner))
		let { root: currentRoot } = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		let freshDocumentsId = currentRoot.documents.$jazz.id
		currentRoot.documents.$jazz.push(makeDoc("# Post incident\nnew"))

		let otherAccount = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})
		setActiveAccount(otherAccount)
		let unauthorizedSpaces = co.list(Space).create([], Group.create())
		setActiveAccount(account)

		// documents id is valid and loadable; spaces id is unauthorized for this
		// account, so its load fails AFTER documents already loaded fine.
		let outcome = await recoverAccount({
			documents: oldDocumentsId,
			spaces: unauthorizedSpaces.$jazz.id,
			force: true,
		})
		expect(outcome).toBe("refused")

		let { root: after } = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		expect(after.documents.$jazz.id).toBe(freshDocumentsId)

		let oldList = await co.list(Document).load(oldDocumentsId, {
			resolve: { $each: true },
		})
		expect(oldList?.$isLoaded).toBe(true)
		if (oldList?.$isLoaded) {
			expect(oldList.length).toBe(oldDocsCountBefore)
		}
	})
})
