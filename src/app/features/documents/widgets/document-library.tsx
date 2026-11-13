import { useEffect, useState } from "react"
import { useAll, useDb, useJazzSession, useSession } from "jazz-tools/react"
import { app, type DocumentRow, type UserDocumentRow } from "@/jazz/schema"
import { AuthDialog } from "@/app/features/auth"
import { parseWikiLinks } from "@/app/features/editor"
import { Button } from "@/app/components/ui/button"
import { DocumentEditor } from "./document-editor"
import { watchWrite } from "../lib/writes"
import { toast } from "sonner"

export { DocumentLibrary }

function DocumentLibrary() {
	let session = useSession()
	if (!session?.user) return <p role="status">Opening account…</p>
	return <Library key={session.user} ownerId={session.user} />
}

function Library({ ownerId }: { ownerId: string }) {
	let db = useDb()
	let auth = useJazzSession()
	let {
		data: documents = [],
		isLoading,
		error,
	} = useAll(app.documents.where({ deletedAt: null }))
	let { data: entries = [] } = useAll(app.userDocuments.where({ ownerId }))
	let { data: folders = [] } = useAll(app.folders.where({ ownerId }))
	let [selected, setSelected] = useState(readDocumentId)
	let [authOpen, setAuthOpen] = useState(false)
	let [search, setSearch] = useState("")
	let current = documents.find(doc => doc.id === selected)
	let currentEntry = entries.find(entry => entry.documentId === selected)
	let visible = documents
		.filter(doc => doc.title.toLowerCase().includes(search.toLowerCase()))
		.sort((a, b) => {
			let first = entries.find(entry => entry.documentId === a.id)
			let second = entries.find(entry => entry.documentId === b.id)
			return (
				Number(second?.pinned ?? false) - Number(first?.pinned ?? false) ||
				(first?.rank ?? 0) - (second?.rank ?? 0)
			)
		})

	useEffect(() => {
		function handlePopState() {
			setSelected(readDocumentId())
		}
		window.addEventListener("popstate", handlePopState)
		return () => window.removeEventListener("popstate", handlePopState)
	}, [])
	useEffect(() => db.onMutationError(error => toast.error(error.reason)), [db])

	function navigate(id: string | null) {
		window.history.pushState(null, "", id ? `/app/doc/${id}` : "/app/")
		setSelected(id)
	}
	async function createDocument() {
		try {
			let write = await db.transaction(tx => {
				let value = tx.insert(app.documents, {
					ownerId,
					title: "Untitled",
					content: "",
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				tx.insert(app.userDocuments, {
					ownerId,
					documentId: value.id,
					rank: Date.now(),
				})
				return value
			})
			let doc = await write.wait({ tier: "local" })
			navigate(doc.id)
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not create document",
			)
		}
	}
	function createFolder() {
		let name = window.prompt("Folder name")?.trim()
		if (name)
			watchWrite(
				db.insert(app.folders, { ownerId, name, rank: entries.length }),
			)
	}
	function moveToFolder(folderId: string) {
		if (!current) return
		if (currentEntry)
			watchWrite(
				db.update(app.userDocuments, currentEntry.id, {
					folderId: folderId || null,
				}),
			)
		else
			watchWrite(
				db.insert(app.userDocuments, {
					ownerId,
					documentId: current.id,
					folderId: folderId || null,
					rank: entries.length,
				}),
			)
	}
	async function signOut() {
		try {
			await auth.signOut()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not sign out")
		}
	}
	function documentLink(doc: DocumentRow) {
		let entry = entries.find(entry => entry.documentId === doc.id)
		return (
			<li key={doc.id}>
				<button
					className={`w-full rounded px-2 py-1.5 text-left text-sm ${selected === doc.id ? "bg-muted font-semibold" : "hover:bg-muted"}`}
					onClick={() => navigate(doc.id)}
				>
					{entry?.pinned ? "★ " : ""}
					{doc.title || "Untitled"}
				</button>
			</li>
		)
	}
	return (
		<div className="text-foreground flex h-[100dvh]">
			<aside
				className="bg-background flex w-64 shrink-0 flex-col gap-3 overflow-auto border-r p-3 max-sm:w-40"
				aria-label="Document library"
			>
				<h1 className="text-lg font-semibold">Alkalye</h1>
				<Button size="sm" onClick={createDocument}>
					New document
				</Button>
				<input
					aria-label="Search documents"
					placeholder="Search documents"
					className="w-full rounded border p-2 text-sm"
					value={search}
					onChange={event => setSearch(event.target.value)}
				/>
				<ul>
					{visible
						.filter(
							doc =>
								!entries.find(entry => entry.documentId === doc.id)?.folderId,
						)
						.map(documentLink)}
				</ul>
				{folders.map(folder => (
					<section key={folder.id}>
						<h2 className="text-muted-foreground px-2 text-xs font-semibold">
							{folder.name}
						</h2>
						<ul>
							{visible
								.filter(
									doc =>
										entries.find(entry => entry.documentId === doc.id)
											?.folderId === folder.id,
								)
								.map(documentLink)}
						</ul>
					</section>
				))}
				<Button variant="ghost" size="sm" onClick={createFolder}>
					New folder
				</Button>
				<div className="mt-auto flex flex-col gap-2">
					<Button variant="outline" size="sm" onClick={() => setAuthOpen(true)}>
						Account / recovery phrase
					</Button>
					<Button variant="ghost" size="sm" onClick={signOut}>
						Sign out
					</Button>
				</div>
			</aside>
			<main className="flex min-w-0 flex-1 flex-col">
				{error ? (
					<p role="alert">{error.message}</p>
				) : isLoading ? (
					<p role="status">Loading documents…</p>
				) : current ? (
					<>
						<DocumentToolbar
							key={`toolbar:${current.id}`}
							doc={current}
							entry={currentEntry}
							onDeleted={() => navigate(null)}
						/>
						<label className="flex items-center gap-2 border-b px-4 py-2 text-sm">
							Folder{" "}
							<select
								aria-label="Move to folder"
								value={currentEntry?.folderId ?? ""}
								onChange={event => moveToFolder(event.target.value)}
							>
								<option value="">Unfiled</option>
								{folders.map(folder => (
									<option key={folder.id} value={folder.id}>
										{folder.name}
									</option>
								))}
							</select>
						</label>
						<DocumentEditor
							key={current.id}
							doc={current}
							documents={documents}
							navigate={navigate}
						/>
						<DocumentLinks
							doc={current}
							documents={documents}
							navigate={navigate}
						/>
					</>
				) : (
					<div className="m-auto max-w-lg p-8 text-center">
						<h2 className="mb-3 text-xl">
							{selected ? "Document unavailable" : "Your library"}
						</h2>
						<p>
							{selected
								? "This document may be deleted or not shared with this account."
								: "Create a document to start writing. Back up your account with its 24 recovery words."}
						</p>
					</div>
				)}
			</main>
			<AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
		</div>
	)
}

function DocumentToolbar({
	doc,
	entry,
	onDeleted,
}: {
	doc: DocumentRow
	entry: UserDocumentRow | undefined
	onDeleted: () => void
}) {
	let db = useDb()
	function rename() {
		let title = window.prompt("Document title", doc.title)?.trim()
		if (title)
			watchWrite(
				db.update(app.documents, doc.id, { title, updatedAt: new Date() }),
			)
	}
	function remove() {
		if (!window.confirm(`Delete “${doc.title}”?`)) return
		watchWrite(db.update(app.documents, doc.id, { deletedAt: new Date() }))
		onDeleted()
	}
	return (
		<header className="flex items-center gap-2 border-b px-4 py-3">
			<h2 className="mr-auto truncate font-semibold">{doc.title}</h2>
			<Button size="sm" variant="ghost" onClick={rename}>
				Rename
			</Button>
			{entry && (
				<Button
					size="sm"
					variant="ghost"
					onClick={() =>
						watchWrite(
							db.update(app.userDocuments, entry.id, { pinned: !entry.pinned }),
						)
					}
				>
					{entry.pinned ? "Unpin" : "Pin"}
				</Button>
			)}
			<Button size="sm" variant="ghost" onClick={remove}>
				Delete
			</Button>
		</header>
	)
}

function DocumentLinks({
	doc,
	documents,
	navigate,
}: {
	doc: DocumentRow
	documents: DocumentRow[]
	navigate: (id: string) => void
}) {
	let links = parseWikiLinks(doc.content)
	let backlinks = documents.filter(candidate =>
		parseWikiLinks(candidate.content).some(link => link.id === doc.id),
	)
	return (
		<footer className="flex flex-wrap gap-4 border-t px-4 py-2 text-sm">
			<div>
				Links:{" "}
				{links.length
					? links.map(link => (
							<button
								key={link.from}
								className="mx-1 underline"
								onClick={() => navigate(link.id)}
							>
								{link.alias ??
									documents.find(candidate => candidate.id === link.id)
										?.title ??
									"Missing document"}
							</button>
						))
					: "None"}
			</div>
			<div>
				Backlinks:{" "}
				{backlinks.length
					? backlinks.map(link => (
							<button
								key={link.id}
								className="mx-1 underline"
								onClick={() => navigate(link.id)}
							>
								{link.title}
							</button>
						))
					: "None"}
			</div>
		</footer>
	)
}

function readDocumentId() {
	return window.location.pathname.match(/^\/app\/doc\/([^/]+)/)?.[1] ?? null
}
