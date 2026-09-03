import { co, type ResolveQuery } from "jazz-tools"
import { useCoState, useAccount } from "jazz-tools/react"
import { Document } from "./schema"
import { UserAccount } from "@/schema"
import { assetPreviewResolve } from "@/app/features/assets/lib/asset-resolve"

export { loaderResolve, resolve, settingsResolve, meResolve }
export type { LoadedDocument, LoaderDocument, MaybeDocWithContent, LoadedMe }

type LoadedDocument = co.loaded<typeof Document, typeof resolve>
type LoaderDocument = co.loaded<typeof Document, typeof loaderResolve>
type MaybeDocWithContent = ReturnType<
	typeof useCoState<typeof Document, { content: true }>
>
type LoadedMe = ReturnType<
	typeof useAccount<typeof UserAccount, typeof meResolve>
>

let loaderResolve = {
	content: true,
} as const satisfies ResolveQuery<typeof Document>

let resolve = {
	content: true,
	cursors: true,
	assets: {
		$each: assetPreviewResolve,
	},
	comments: { $each: { replies: true } },
} as const satisfies ResolveQuery<typeof Document>

let settingsResolve = {
	root: { settings: true },
} as const satisfies ResolveQuery<typeof UserAccount>

let meResolve = {
	root: {
		documents: { $each: true },
		spaces: {
			$each: {
				documents: { $each: true },
			},
		},
		settings: true,
	},
} as const satisfies ResolveQuery<typeof UserAccount>
