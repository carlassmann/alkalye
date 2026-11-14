import { schema as s } from "jazz-tools"
import { createJazzClient } from "jazz-tools/client"

export { runLargeTextRepro }

let app = s.defineApp(
	{
		notes: s.table(
			{
				content: s.string().merge("markdown"),
				title: s.string(),
			},
			{},
		),
	},
	{ migrations: "none" },
)

async function runLargeTextRepro(
	mode: "none" | "title" | "whole" | "splices" | "window",
	partialWrite = false,
) {
	let session = await createJazzClient({
		serverUrl: null,
		initial: "device",
		localFirst: "now",
		client: () => import("jazz-tools/local-first"),
	})
	let db = session.db
	let content = "# Dracula\n\n" + "Large document text.\n".repeat(43750)
	let note = await db
		.insert(app.notes, { title: "Dracula", content })
		.wait({ tier: "local" })
	let query =
		mode === "window"
			? app.notes
					.where({ id: note.id })
					.select({ content: { from: 0, to: 128 } })
			: app.notes.where({ id: note.id }).select("content")
	let terminalError: Error | undefined
	let deliveries = 0
	let callbacks = {
		onUpdate() {
			deliveries++
		},
		onError(error: Error) {
			terminalError = error
		},
	}
	let stop =
		mode === "none"
			? () => {}
			: mode === "title"
				? db.subscribe(
						app.notes.where({ id: note.id }).select("title"),
						callbacks,
					)
				: db.subscribe(
						query,
						callbacks,
						mode === "splices" ? { splices: ["content"] } : undefined,
					)
	await new Promise(resolve => setTimeout(resolve, 1000))
	if (terminalError) throw terminalError
	if (mode !== "none" && deliveries === 0)
		throw new Error("Subscription never delivered")
	let samples: number[] = []
	for (let i = 0; i < 200; i++) {
		let before = content
		content = "x" + before
		let start = performance.now()
		let write = partialWrite
			? db.update(
					app.notes,
					note.id,
					{},
					{
						applyDiffs: {
							content: {
								within: { from: 0, to: 0 },
								splices: [{ at: 0, delete: 0, insert: "x" }],
							},
						},
					},
				)
			: db.update(
					app.notes,
					note.id,
					{ content },
					{ editedFrom: { content: before } },
				)
		await write.wait({ tier: "local" })
		await new Promise<void>(resolve =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		)
		samples.push(performance.now() - start)
	}
	if (terminalError) throw terminalError
	stop()
	let actual = await db.one(app.notes.where({ id: note.id }).select("content"))
	if (actual?.content !== content) throw new Error("Content diverged")
	await session.close()
	samples.sort((a, b) => a - b)
	return {
		mode,
		partialWrite,
		deliveries,
		median: samples[100],
		p95: samples[190],
	}
}
