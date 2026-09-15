import { redirect } from "@tanstack/react-router"
import { co, Group, type ResolveQuery } from "jazz-tools"
import { Document, Space, createSpaceDocument } from "@/schema"
import { SpaceNotFound, SpaceUnauthorized } from "@/app/components/error-states"
import { waitForLocalJazzNodeStorage } from "@/app/lib/local-jazz-poke"

export { SpaceListScreen, spaceListLoader, spaceListResolve }

let spaceListResolve = {
	documents: { $each: true, $onError: "catch" },
} as const satisfies ResolveQuery<typeof Space>

type SpaceListLoaderData = { loadingState: string | null }

async function spaceListLoader(spaceId: string): Promise<SpaceListLoaderData> {
	let space = await Space.load(spaceId, { resolve: spaceListResolve })

	if (!space.$isLoaded) {
		return { loadingState: space.$jazz.loadingState }
	}

	if (!space.documents?.$isLoaded) {
		return { loadingState: "error" as const }
	}

	let docs: co.loaded<typeof Document>[] = []
	for (let doc of space.documents.values()) {
		if (!doc?.$isLoaded || doc.deletedAt) continue
		docs.push(doc)
	}
	let mostRecentDoc = docs
		.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		)
		.at(0)

	if (mostRecentDoc) {
		throw redirect({
			to: "/spaces/$spaceId/doc/$id",
			params: { spaceId, id: mostRecentDoc.$jazz.id },
		})
	}

	let spaceGroup = space.$jazz.owner instanceof Group ? space.$jazz.owner : null
	let canWrite =
		spaceGroup?.myRole() === "admin" || spaceGroup?.myRole() === "writer"

	if (!canWrite) {
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

interface SpaceListScreenProps {
	loaderData: SpaceListLoaderData
}

function SpaceListScreen({ loaderData }: SpaceListScreenProps) {
	if (loaderData.loadingState === "unauthorized") {
		return <SpaceUnauthorized />
	}
	return <SpaceNotFound />
}
