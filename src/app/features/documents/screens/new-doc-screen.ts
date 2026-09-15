import { redirect } from "@tanstack/react-router"
import { type ResolveQuery } from "jazz-tools"
import { UserAccount, Space } from "@/schema"
import { createSpaceDocument } from "../lib/create-space-document"
import { createPersonalDocument } from "./../lib/documents"
import {
	waitForLocalJazzStorage,
	waitForLocalJazzNodeStorage,
} from "@/app/lib/local-jazz-poke"

export { newDocLoader, newDocSpaceQuery, newDocDocumentsQuery }

let newDocDocumentsQuery = {
	root: {
		documents: true,
	},
} as const satisfies ResolveQuery<typeof UserAccount>

let newDocSpaceQuery = {
	documents: true,
} as const satisfies ResolveQuery<typeof Space>

interface NewDocLoaderArgs {
	context: { me: import("jazz-tools").co.loaded<typeof UserAccount> | null }
	spaceId?: string
}

async function newDocLoader({ context, spaceId }: NewDocLoaderArgs) {
	let { me } = context
	if (!me) throw redirect({ to: "/" })

	// Space context: create doc in space.documents
	if (spaceId) {
		let space = await Space.load(spaceId, { resolve: newDocSpaceQuery })
		if (!space.$isLoaded || !space.documents?.$isLoaded) {
			throw redirect({ to: "/" })
		}

		let newDoc = createSpaceDocument(space.$jazz.owner, spaceId, "")
		space.documents.$jazz.push(newDoc)
		await waitForLocalJazzNodeStorage(space.$jazz.localNode)

		throw redirect({
			to: "/spaces/$spaceId/doc/$id",
			params: { spaceId, id: newDoc.$jazz.id },
		})
	}

	// Personal context: create doc in UserRoot.documents
	let loadedMe = await me.$jazz.ensureLoaded({ resolve: newDocDocumentsQuery })
	let docs = loadedMe.root?.documents
	if (!docs?.$isLoaded) throw redirect({ to: "/" })

	let newDoc = await createPersonalDocument(loadedMe, "")
	await waitForLocalJazzStorage(me)

	throw redirect({
		to: "/doc/$id",
		params: { id: newDoc.$jazz.id },
	})
}
