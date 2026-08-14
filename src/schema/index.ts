import { co, z } from "jazz-tools"
import { Settings } from "@/app/features/settings/lib/schema"
import { Theme } from "@/app/features/themes/lib/schema"
import { Document } from "@/app/features/documents/lib/schema"
import { Space } from "@/app/features/spaces/lib/schema"
import { runAccountMigration } from "@/schema/migrations"

export {
	ImageAsset,
	VideoAsset,
	TldrawAsset,
	TldrawRevision,
	Asset,
} from "@/app/features/assets/lib/schema"

export { Space } from "@/app/features/spaces/lib/schema"
export { createSpace } from "@/app/features/spaces/lib/create-space"

export {
	Document,
	CursorEntry,
	CursorFeed,
	CommentTextPosition,
	CommentAnchor,
	CommentReply,
	CommentThread,
	ArchivedDocumentContent,
} from "@/app/features/documents/lib/schema"
export { createSpaceDocument } from "@/app/features/documents/lib/create-space-document"

export { migrateAnonymousData } from "@/app/features/auth/lib/migrate-anonymous-data"

export { getRandomWriterName } from "@/app/features/onboarding/lib/random-writer-name"

export {
	Settings,
	EditorSettings,
	DEFAULT_EDITOR_SETTINGS,
} from "@/app/features/settings/lib/schema"

export {
	Theme,
	ThemeAsset,
	ThemePreset,
	ThemeType,
} from "@/app/features/themes/lib/schema"

export { UserProfile, UserRoot, UserAccount }

let UserProfile = co.profile({
	name: z.string(),
})

let UserRoot = co.map({
	documents: co.list(Document),
	inactiveDocuments: co.optional(co.list(Document)),
	spaces: co.optional(co.list(Space)),
	settings: co.optional(Settings),
	themes: co.optional(co.list(Theme)),
	language: z.enum(["de", "en"]).optional(),
	migrationVersion: z.number().optional(),
	lastOpenedDocId: z.string().optional(),
	lastOpenedSpaceId: z.string().optional(),
})

let UserAccount = co
	.account({
		profile: UserProfile,
		root: UserRoot,
	})
	.withMigration(runAccountMigration)
