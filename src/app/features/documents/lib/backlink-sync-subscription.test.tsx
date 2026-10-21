import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { co, Group } from "jazz-tools"
import { JazzTestProvider } from "jazz-tools/react/testing"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { Document, Space, UserAccount } from "@/schema"
import { createPersonalDocument } from "./documents"
import { useBacklinkSync } from "./backlink-sync"
import { getBacklinks } from "@/app/features/editor/lib/frontmatter"

let account: co.loaded<typeof UserAccount>
let root: Root | undefined

beforeEach(async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
	await setupJazzTestSync()
	account = await createJazzTestAccount({
		isCurrentActiveAccount: true,
		AccountSchema: UserAccount,
	})
})

afterEach(async () => {
	await act(async () => root?.unmount())
	root = undefined
	vi.unstubAllGlobals()
})

test("document metadata echoes do not rerender the backlink consumer", async () => {
	let doc = await createPersonalDocument(account, "Source")
	let probe = await mount(doc.$jazz.id)
	let before = probe.renders
	await act(async () => {
		doc.$jazz.set("updatedAt", new Date(Date.now() + 1000))
		doc.$jazz.set("title", "Renamed")
	})
	expect(probe.renders).toBe(before)
})

test("new documents become eligible backlink targets", async () => {
	let source = await createPersonalDocument(account, "Source")
	let probe = await mount(source.$jazz.id)
	let target = await act(() => createPersonalDocument(account, "Target"))
	await act(async () => probe.sync(`[[${target.$jazz.id}]]`))
	await act(async () => {
		await vi.waitFor(() =>
			expect(getBacklinks(target.content.toString())).toContain(
				source.$jazz.id,
			),
		)
	})
})

test("deleted documents stop receiving backlinks", async () => {
	let source = await createPersonalDocument(account, "Source")
	let target = await createPersonalDocument(account, "Target")
	let probe = await mount(source.$jazz.id)
	await act(async () => target.$jazz.set("deletedAt", new Date()))
	await act(async () => {
		probe.sync(`[[${target.$jazz.id}]]`)
		await new Promise(resolve => setTimeout(resolve, 500))
	})
	expect(getBacklinks(target.content.toString())).toEqual([])
})

test("space targets update independently of metadata and personal documents", async () => {
	let group = Group.create(account)
	let space = Space.create(
		{
			name: "Space",
			documents: co.list(Document).create([], group),
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		group,
	)
	let loaded = await space.$jazz.ensureLoaded({
		resolve: { documents: { $each: {} } },
	})
	let source = spaceDocument(group, space.$jazz.id, "Source")
	loaded.documents.$jazz.push(source)
	let personal = await createPersonalDocument(account, "Personal")
	let probe = await mount(source.$jazz.id, space.$jazz.id)
	let before = probe.renders
	await act(async () => source.$jazz.set("title", "Renamed"))
	expect(probe.renders).toBe(before)
	let target = spaceDocument(group, space.$jazz.id, "Target")
	await act(async () => loaded.documents.$jazz.push(target))
	await act(async () => {
		probe.sync(`[[${target.$jazz.id}]] [[${personal.$jazz.id}]]`)
		await vi.waitFor(() =>
			expect(getBacklinks(target.content.toString())).toContain(
				source.$jazz.id,
			),
		)
	})
	expect(getBacklinks(personal.content.toString())).toEqual([])
})

function spaceDocument(group: Group, spaceId: string, content: string) {
	return Document.create(
		{
			version: 1,
			content: co.plainText().create(content, group),
			spaceId,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		group,
	)
}

async function mount(documentId: string, spaceId?: string) {
	let renders = 0
	let sync: (content: string) => void = () => {
		throw new Error("Backlink consumer has not mounted")
	}
	function Probe() {
		renders++
		sync = useBacklinkSync(documentId, false, { spaceId }).syncBacklinks
		return null
	}
	root = createRoot(document.createElement("div"))
	await act(async () => {
		root?.render(
			<JazzTestProvider account={account}>
				<Probe />
			</JazzTestProvider>,
		)
	})
	return {
		get renders() {
			return renders
		},
		sync(content: string) {
			sync(content)
		},
	}
}
