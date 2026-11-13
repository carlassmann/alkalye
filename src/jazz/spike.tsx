import { JazzProvider, useAll, useSession } from "jazz-tools/react"
import { app } from "./schema"

export function Spike() {
	return (
		<JazzProvider
			config={{
				serverUrl: "/jazz",
				initial: "device",
				localFirst: "now",
				client: () => import("jazz-tools/local-first"),
			}}
			loading={<p>Loading Jazz</p>}
		>
			<Notes />
		</JazzProvider>
	)
}
function Notes() {
	let { data = [], db, error } = useAll(app.documents.where({}))
	let session = useSession()
	return (
		<main>
			<h1>Jazz foundation spike</h1>
			<p>{error?.message}</p>
			<p>Local first: {String(db.isLocalFirst())}</p>
			<button
				onClick={() => {
					if (session)
						db.insert(app.documents, {
							ownerId: session.user,
							title: "Spike note",
							content: "Hello v2",
						})
				}}
			>
				Create note
			</button>
			{data.map(note => (
				<p key={note.id}>
					{note.title}: {note.content}
				</p>
			))}
		</main>
	)
}
