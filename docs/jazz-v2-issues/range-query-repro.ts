import { schema as s } from "jazz-tools"
import { createJazz, memory } from "jazz-tools/backend"

let app = s.defineApp(
	{ notes: s.table({ content: s.string().merge("markdown") }, {}) },
	{ migrations: "none" },
)
let jazz = await createJazz({
	app,
	store: memory(),
	permissions: s.definePermissions(app, ({ policy }) => {
		policy.notes.allowRead.always()
		policy.notes.allowInsert.always()
		policy.notes.allowUpdate.always()
		policy.notes.allowDelete.always()
	}),
}).ready()
let events: string[] = []
let stop = () => {}
try {
	let note = await jazz.db
		.insert(app.notes, { content: "abcdefgh" })
		.wait({ tier: "global" })
	stop = jazz.db.subscribe(
		app.notes.where({ id: note.id }).select({ content: { from: 0, to: 8 } }),
		{
			onUpdate(rows) {
				events.push(`update: ${rows[0]?.content}`)
			},
			onError(error) {
				events.push(`error: ${error.message}`)
			},
		},
	)
	await settle()
	for (let content of ["ab", "abcdefgh"]) {
		await jazz.db
			.update(app.notes, note.id, { content })
			.wait({ tier: "global" })
		await settle()
	}
	if (
		events.length !== 2 ||
		events[0] !== "update: abcdefgh" ||
		!events[1]?.includes("value range is out of bounds")
	)
		throw new Error(
			`Unexpected subscription behavior: ${JSON.stringify(events)}`,
		)
	process.stdout.write(events.join("\n") + "\n")
} finally {
	stop()
	await jazz.close()
}

function settle() {
	return new Promise(resolve => setTimeout(resolve, 100))
}
