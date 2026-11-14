import { schema as s, migration as m } from "jazz-tools"

export default m.defineMigration({
	createTables: {
		classicImportStatus: true,
		classicUploadSlots: true,
		classicUploads: true,
	},
	migrate: {
		classicImportChunks: {
			// TODO: No safe migration steps were inferred automatically.
		},
	},
	fromHash: "b7b44e9a8d51",
	toHash: "370e85e4dd4b",
	from: {
		classicImportChunks: s.table(
			{
				ownerId: s.uuid(),
				uploadId: s.string(),
				part: s.int(),
				data: s.bytes(),
				createdAt: s.timestamp(),
			},
			{},
		),
	},
	to: {
		classicImportChunks: s
			.table(
				{
					ownerId: s.uuid(),
					uploadId: s.string(),
					part: s.int(),
					data: s.bytes(),
					createdAt: s.timestamp(),
				},
				{},
			)
			.history("latest"),
		classicImportStatus: s.table(
			{
				ownerId: s.uuid(),
				classicId: s.string(),
				v2Id: s.uuid(),
				kind: s.string(),
				status: s.enum("waiting", "complete", "failed"),
			},
			{},
		),
		classicUploads: s.table(
			{
				ownerId: s.uuid(),
				uploadId: s.string(),
				classicId: s.string(),
				kind: s.enum("document", "space", "theme", "account"),
				byteLength: s.int(),
				expiresAt: s.timestamp(),
			},
			{},
		),
		classicUploadSlots: s.table(
			{
				ownerId: s.uuid(),
				uploadId: s.string(),
			},
			{},
		),
	},
})
