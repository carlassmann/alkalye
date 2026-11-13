import { makeDuplicate } from "../lib/document-file-actions"
import {
	SidebarComments,
	useComments,
	areCommentsEnabled,
	getVisibleCommentThreads,
	getUnresolvedCommentCount,
	createCommentThread,
	getCommentRange,
	setCommentsEnabled,
	commentsExtension,
	scrollEditorCommentIntoView,
	setCommentDecorationsEffect,
} from "@/app/features/comments"
import {
	presentationExtensions,
	SidebarPresentationLinks,
} from "@/app/features/presentation"
import { handleSaveCopy } from "../lib/save-copy"
import { useIsBackedUp } from "@/app/features/auth"
import { toast } from "sonner"
import {
	SidebarAssets,
	useDocumentAssets,
	uploadAsset,
	useTldrawEditor,
	createTldrawAsset,
	updateTldrawAsset,
	readAssetBlob,
} from "@/app/features/assets"
import { useSpaces, createSpaceDocument } from "@/app/features/spaces"
import { usePresence } from "@/app/features/sharing"
import { SpaceSelector } from "@/app/features/spaces"
import { SidebarCollaboration } from "@/app/features/sharing"
import {
	SidebarImportExport,
	handleImportFiles,
} from "@/app/features/import-export"
import { MessageSquareOff, MessageSquare } from "lucide-react"
import { SidebarMenuItem, SidebarMenuButton } from "@/app/components/ui/sidebar"
import { useTrackLastOpened } from "../hooks/use-track-last-opened"
import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import { useDocumentContent } from "../hooks/use-document-content"
import { Plus, Settings, HelpCircle } from "lucide-react"
import {
	app,
	useLibrary,
	createDocument,
	updateContent,
	type LibraryDocument,
} from "../lib/library"
import { makeFolderDocumentContent } from "../lib/folders"
import { codeMirrorSync } from "../lib/codemirror-sync"
import { DocumentCommands } from "../widgets/document-commands"
import { DocumentSidebar } from "../widgets/document-sidebar"
import { ListSidebar } from "../widgets/list-sidebar"
import { SidebarDocumentList } from "../widgets/sidebar-document-list"
import { SidebarFileMenu } from "../widgets/sidebar-file-menu"
import { SidebarViewLinks } from "../widgets/sidebar-view-links"
import {
	MarkdownEditor,
	useMarkdownEditorRef,
	EditorToolbar,
	EditorStatsBadge,
	SidebarEditMenu,
	SidebarFormatMenu,
	SidebarEditorNavigation,
	useEditorSettings,
} from "@/app/features/editor"
import {
	SidebarProvider,
	useSidebar,
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarSeparator,
} from "@/app/components/ui/sidebar"
import { Button } from "@/app/components/ui/button"
import { SidebarSyncStatus } from "@/app/components/sidebar-sync-status"
import { ThemeToggle, useTheme } from "@/app/components/appearance"
import { HelpMenu } from "@/app/components/help-menu"
import {
	DocumentNotFound,
	DocumentUnauthorized,
} from "@/app/components/error-states"
import { useIntl } from "@/shared/intl/setup"
import { testIds } from "@/app/lib/test-ids"

export { DocScreen, PersonalDocumentSidebar }

function DocScreen({ id, spaceId }: { id: string; spaceId?: string }) {
	let incoming = useDocumentContent(id)
	let { documents, isLoading } = useLibrary()
	let doc = documents.find(doc => doc.id === id)
	if (!incoming || isLoading) return <p role="status">Opening document…</p>
	if (incoming.content === null || !doc) return <DocumentUnauthorized />
	if (doc.deletedAt) return <DocumentNotFound />
	return (
		<SidebarProvider>
			{spaceId ? (
				<SpaceDocumentSidebar key={spaceId} docId={id} spaceId={spaceId} />
			) : (
				<PersonalDocumentSidebar docId={id} />
			)}
			<DocumentEditor
				key={id + ":" + (doc.spaceId ?? "")}
				doc={{ ...doc, content: incoming.content }}
				incoming={incoming.update}
			/>
		</SidebarProvider>
	)
}

function DocumentEditor({
	doc,
	incoming,
}: {
	doc: LibraryDocument & { content: string }
	incoming?: import("../lib/codemirror-sync").TextUpdate
}) {
	let { db, ownerId, documents, entries, settings, profile } = useLibrary()
	useTrackLastOpened(ownerId, doc.id, doc.spaceId ?? undefined)
	let t = useIntl()
	let navigate = useNavigate()
	let editor = useMarkdownEditorRef()
	let { toggleLeft, toggleRight, isMobile, setRightOpenMobile, setRightOpen } =
		useSidebar()
	let { theme, setTheme } = useTheme()
	let [saveCopyState, setSaveCopyState] = useState<"idle" | "saving" | "saved">(
		"idle",
	)
	let backedUp = useIsBackedUp()
	let [selectionCount, setSelectionCount] = useState(1)
	let readOnly = !doc.canEdit
	let presence = usePresence({ doc, editorRef: editor })
	useEditorSettings(settings)
	let { sidebarAssets, editorAssets } = useDocumentAssets(doc.id, doc.content)
	let tldraw = useTldrawEditor({
		assets: sidebarAssets,
		readOnly,
		createAsset: (name, save) => createTldrawAsset(db, doc.id, name, save),
		updateAsset: (id, save) => updateTldrawAsset(db, doc.id, id, save),
		loadAsset: async id => {
			let asset = await db.one(app.assets.where({ id }).select("revisionId"))
			if (!asset?.revisionId) throw new Error("Whiteboard unavailable")
			let revision = await db.one(
				app.tldrawRevisions
					.where({ id: asset.revisionId })
					.select("snapshot", "createdAt"),
			)
			if (!revision) throw new Error("Whiteboard unavailable")
			return {
				json: new TextDecoder().decode(revision.snapshot),
				lastModified: revision.createdAt.getTime(),
			}
		},
	})
	function insertAsset(id: string, name: string) {
		let view = editor.current?.getEditor()
		if (view)
			view.dispatch(view.state.replaceSelection(`![${name}](asset:${id})`))
	}

	let [binding] = useState(() =>
		codeMirrorSync(doc.content, (content, editedFrom) => {
			void updateContent(db, doc, content, editedFrom).catch(error =>
				toast.error(
					error instanceof Error ? error.message : "Could not save document",
				),
			)
		}),
	)
	useEffect(() => {
		document.body.dataset.alkalyeReady = "true"
		window.__alkalyeReady = true
		window.__alkalyeReadyRoute = doc.spaceId ? "space-doc" : "personal-doc"
		return () => {
			binding.destroy()
			document.body.dataset.alkalyeReady = "false"
			window.__alkalyeReady = false
		}
	}, [binding, doc.spaceId])

	let commentDoc = useComments(doc)
	let commentsEnabled = areCommentsEnabled(commentDoc)
	let commentThreads = getVisibleCommentThreads(commentDoc)
	let [rightTab, setRightTab] = useState("tools")
	let [selectedCommentThreadId, setSelectedCommentThreadId] = useState<
		string | null
	>(null)
	let unresolvedCommentCount = getUnresolvedCommentCount(commentDoc)
	function openCommentsTab() {
		setRightTab("comments")
		if (isMobile) setRightOpenMobile(true)
		else setRightOpen(true)
	}
	function handleSelectComment(threadId: string) {
		setSelectedCommentThreadId(selected =>
			selected === threadId ? null : threadId,
		)
		openCommentsTab()
	}
	useEffect(() => {
		let view = editor.current?.getEditor(),
			thread = commentThreads.find(
				thread => thread.id === selectedCommentThreadId,
			)
		if (view && thread)
			scrollEditorCommentIntoView(
				view,
				getCommentRange(commentDoc, thread.anchor),
			)
	}, [selectedCommentThreadId])

	function handleCreateCommentFromSelection(
		selection: { from: number; to: number },
		body: string,
	) {
		let content =
			editor.current?.getEditor()?.state.doc.toString() ?? doc.content
		let thread = createCommentThread(
			{ ...commentDoc, content },
			selection,
			body,
			profile?.name,
		)
		if (!thread) return false
		setSelectedCommentThreadId(thread.id)
		openCommentsTab()
		return true
	}
	function handleSetCommentsEnabled(enabled: boolean) {
		void setCommentsEnabled(commentDoc, enabled)
		if (!enabled) {
			setRightTab("tools")
			setSelectedCommentThreadId(null)
		}
	}
	useEffect(() => {
		let view = editor.current?.getEditor()
		if (!view) return
		view.dispatch({
			effects: setCommentDecorationsEffect.of(
				commentThreads.map(thread => ({
					...getCommentRange(commentDoc, thread.anchor),
					id: thread.id,
					resolved: !!thread.resolvedAt,
					selected: thread.id === selectedCommentThreadId,
				})),
			),
		})
	}, [commentDoc, commentThreads, editor, selectedCommentThreadId])
	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") setSelectedCommentThreadId(null)
		}
		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [])
	let wikiDocs = documents
		.filter(
			target =>
				!target.deletedAt &&
				(doc.spaceId
					? target.spaceId === doc.spaceId
					: !target.spaceId &&
						(target.ownerId === ownerId ||
							entries.some(entry => entry.documentId === target.id))),
		)
		.map(doc => ({ id: doc.id, title: doc.title }))
	async function createLinkedDocument(title: string) {
		let content = "# " + title + "\n\n"
		return (
			doc.spaceId
				? await createSpaceDocument(db, ownerId, doc.spaceId, content)
				: await createDocument(db, ownerId, content)
		).id
	}
	return (
		<>
			<title>{doc.title}</title>
			{tldraw.dialog}
			<DocumentCommands
				spaceId={doc.spaceId ?? undefined}
				doc={doc}
				editor={editor}
				documents={wikiDocs}
			/>
			<div className="markdown-editor flex-1" data-testid={testIds.doc.editor}>
				<MarkdownEditor
					ref={editor}
					assets={editorAssets}
					onUploadImage={file => uploadAsset(db, doc.id, file)}
					onUploadVideo={(file, options) =>
						uploadAsset(db, doc.id, file, options)
					}
					onCreateTldraw={tldraw.create}
					onEditTldraw={tldraw.edit}
					onImportTldraw={tldraw.importFile}
					value={doc.content}
					placeholder={t("doc.startWriting")}
					readOnly={readOnly}
					documents={wikiDocs}
					sync={binding}
					syncUpdate={incoming}
					onAddComment={
						!readOnly && commentsEnabled
							? handleCreateCommentFromSelection
							: undefined
					}
					extensions={[
						...presentationExtensions(),
						presence.extension,
						...commentsExtension(handleSelectComment),
					]}
					resolveWikilink={id => {
						let target = documents.find(doc => doc.id === id && !doc.deletedAt)
						return {
							title: target?.title ?? "Missing document",
							exists: Boolean(target),
						}
					}}
					onWikilinkClick={(id, newTab) => {
						if (newTab) window.open("/app/doc/" + id, "_blank", "noopener")
						else void navigate({ to: "/doc/$id", params: { id } })
					}}
					onCreateDocument={createLinkedDocument}
					onCursorChange={(from, to, count) => {
						setSelectionCount(count ?? 1)
						presence.updateCursor(from, to)
					}}
					autoSortTasks={settings?.editor.autoSortTasks}
					spellcheck={settings?.editor.spellcheck ?? true}
					spellcheckLanguage={settings?.editor.spellcheckLanguage}
					smartPairs={settings?.editor.smartPairs ?? true}
					markerWrapping={settings?.editor.markerWrapping ?? true}
					tabIndent={settings?.editor.tabIndent ?? true}
					smartPaste={settings?.editor.smartPaste ?? true}
					autocomplete={settings?.editor.autocomplete ?? true}
				/>
				<EditorToolbar
					editor={editor}
					readOnly={readOnly}
					onToggleLeftSidebar={toggleLeft}
					onToggleRightSidebar={toggleRight}
					docId={doc.id}
					onSaveCopy={
						backedUp && doc.publicRead && doc.ownerId !== ownerId
							? () =>
									handleSaveCopy(db, ownerId, doc, setSaveCopyState, navigate)
							: undefined
					}
					saveCopyState={saveCopyState}
					content={doc.content}
					onThemeChange={content => {
						editor.current?.setContent(content)
					}}
				/>
				<EditorStatsBadge
					content={doc.content}
					settings={settings}
					selectionCount={selectionCount}
				/>
			</div>
			<DocumentSidebar
				tabs={[
					{ id: "tools", label: t("comments.tab.tools") },
					...(commentsEnabled
						? [
								{
									id: "comments",
									label: t("comments.tab.comments"),
									count: unresolvedCommentCount,
								},
							]
						: []),
				]}
				activeTab={commentsEnabled ? rightTab : "tools"}
				onTabChange={setRightTab}
				header={
					<>
						<ThemeToggle theme={theme} setTheme={setTheme} />
						<SettingsButton />
					</>
				}
				footer={
					<HelpMenu
						trigger={
							<Button variant="ghost" size="sm" className="w-full" nativeButton>
								<HelpCircle />
								<span>{t("help.label")}</span>
							</Button>
						}
						align={isMobile ? "center" : "end"}
						side={isMobile ? "top" : "left"}
						onNavigate={() => setRightOpenMobile(false)}
					/>
				}
			>
				{commentsEnabled && rightTab === "comments" ? (
					<SidebarComments
						doc={commentDoc}
						selectedThreadId={selectedCommentThreadId}
						onSelectThread={handleSelectComment}
						readOnly={readOnly}
						authorName={profile?.name}
					/>
				) : (
					<>
						<SidebarGroup>
							<SidebarGroupContent>
								<SidebarMenu>
									<SidebarEditorNavigation
										editor={editor}
										onOpen={open => setRightOpenMobile(false, open)}
									/>
									<SidebarViewLinks doc={doc} />
									<SidebarPresentationLinks doc={doc} />
									<SidebarMenuItem>
										<SidebarMenuButton
											disabled={!doc.canAdmin}
											onClick={() => handleSetCommentsEnabled(!commentsEnabled)}
											nativeButton
										>
											{commentsEnabled ? (
												<MessageSquareOff className="size-4" />
											) : (
												<MessageSquare className="size-4" />
											)}
											{commentsEnabled
												? t("comments.disable")
												: t("comments.enable")}
										</SidebarMenuButton>
									</SidebarMenuItem>
									<SidebarSeparator />
									<SidebarFileMenu
										doc={doc}
										editor={editor}
										spaceId={doc.spaceId ?? undefined}
									/>
									<SidebarEditMenu
										editor={editor}
										disabled={readOnly}
										readOnly={readOnly}
									/>
									<SidebarFormatMenu
										editor={editor}
										disabled={readOnly}
										readOnly={readOnly}
										documents={wikiDocs}
										onCreateDocument={createLinkedDocument}
									/>
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
						<SidebarSeparator />
						<SidebarGroup>
							<SidebarCollaboration docId={doc.id} />
						</SidebarGroup>
						<SidebarSeparator />
						<SidebarGroup className="flex-1">
							<SidebarAssets
								assets={sidebarAssets}
								readOnly={readOnly}
								onUploadImages={files => {
									void Promise.all(
										Array.from(files).map(file =>
											uploadAsset(db, doc.id, file),
										),
									)
								}}
								onUploadVideo={async (file, options) => {
									await uploadAsset(db, doc.id, file, options)
								}}
								canUploadVideo
								onRename={(id, name) => {
									void db.update(app.assets, id, { name })
								}}
								onDelete={id => {
									void updateContent(
										db,
										doc,
										doc.content.replace(
											new RegExp(`!\\[[^\\]]*\\]\\(asset:${id}\\)`, "g"),
											"",
										),
									)
									void db.delete(app.assets, id)
								}}
								onToggleMute={id => {
									let asset = sidebarAssets.find(asset => asset.id === id)
									if (asset)
										void db.update(app.assets, id, {
											muteAudio: !asset.muteAudio,
										})
								}}
								onInsert={insertAsset}
								isAssetUsed={id => doc.content.includes(`asset:${id}`)}
								onCreateTldraw={() => tldraw.create()}
								onEditTldraw={tldraw.edit}
								onImportTldraw={tldraw.importFile}
								onDownload={async (id, name) => {
									let blob = await readAssetBlob(db, id)
									let url = URL.createObjectURL(blob)
									let a = document.createElement("a")
									a.href = url
									a.download =
										name +
										(sidebarAssets.find(asset => asset.id === id)?.type ===
										"tldraw"
											? ".alkalye-tldraw"
											: "." + blob.type.split("/")[1])
									a.click()
									setTimeout(() => URL.revokeObjectURL(url), 1000)
								}}
							/>
						</SidebarGroup>
					</>
				)}
			</DocumentSidebar>
		</>
	)
}

function PersonalDocumentSidebar({ docId }: { docId: string }) {
	let { db, ownerId, documents, entries, isLoading } = useLibrary()
	let navigate = useNavigate()
	let t = useIntl()
	let { isMobile, setLeftOpenMobile } = useSidebar()
	function closeSidebar() {
		if (isMobile) setLeftOpenMobile(false)
	}
	async function duplicate(doc: LibraryDocument) {
		await makeDuplicate(db, doc, ownerId, undefined, navigate)()
		closeSidebar()
	}
	async function createFolder(path: string) {
		let doc = await createDocument(db, ownerId, makeFolderDocumentContent(path))
		closeSidebar()
		void navigate({ to: "/doc/$id", params: { id: doc.id } })
	}
	return (
		<ListSidebar
			header={
				<>
					<SidebarImportExport />
					<Button
						size="sm"
						nativeButton={false}
						data-testid={testIds.doc.newButton}
						render={<Link to="/new" onClick={closeSidebar} />}
					>
						<Plus />
						{t("doc.new")}
					</Button>
				</>
			}
			footer={<SidebarSyncStatus />}
		>
			<SpaceSelector />
			<SidebarDocumentList
				docs={documents.filter(
					doc =>
						(!doc.spaceId && doc.ownerId === ownerId) ||
						entries.some(entry => entry.documentId === doc.id),
				)}
				currentDocId={docId}
				isLoading={isLoading}
				onDocClick={closeSidebar}
				onDuplicate={duplicate}
				onDelete={doc => {
					void db.update(app.documents, doc.id, { deletedAt: new Date() })
					if (doc.id === docId) void navigate({ to: "/" })
				}}
				onCreateFolder={createFolder}
				onImport={files => handleImportFiles(files, db, ownerId)}
			/>
		</ListSidebar>
	)
}
function SettingsButton() {
	let location = useLocation()
	let t = useIntl()
	return (
		<Button
			variant="ghost"
			size="icon"
			nativeButton={false}
			aria-label={t("doc.settings")}
			render={<Link to="/settings" search={{ from: location.pathname }} />}
		>
			<Settings />
		</Button>
	)
}

function SpaceDocumentSidebar({
	docId,
	spaceId,
}: {
	docId: string
	spaceId: string
}) {
	let { db, ownerId, documents, isLoading } = useLibrary()
	let space = useSpaces().find(space => space.id === spaceId)
	let navigate = useNavigate()
	let t = useIntl()
	let { isMobile, setLeftOpenMobile } = useSidebar()
	function closeSidebar() {
		if (isMobile) setLeftOpenMobile(false)
	}
	async function newDocument(content = "") {
		let doc = await createSpaceDocument(db, ownerId, spaceId, content)
		closeSidebar()
		void navigate({
			to: "/spaces/$spaceId/doc/$id",
			params: { spaceId, id: doc.id },
		})
	}
	return (
		<ListSidebar
			header={
				<>
					<SidebarImportExport
						docs={documents.filter(doc => doc.spaceId === spaceId)}
						onImport={(files, options) =>
							handleImportFiles(files, db, ownerId, { ...options, spaceId })
						}
					/>
					<Button
						size="sm"
						data-testid={testIds.doc.newButton}
						disabled={!space?.role || space.role === "reader"}
						nativeButton={false}
						render={
							<Link to="/new" search={{ spaceId }} onClick={closeSidebar} />
						}
					>
						<Plus />
						{t("doc.new")}
					</Button>
				</>
			}
			footer={<SidebarSyncStatus />}
		>
			<SpaceSelector />
			<SidebarDocumentList
				docs={documents.filter(doc => doc.spaceId === spaceId)}
				currentDocId={docId}
				spaceId={spaceId}
				isLoading={isLoading}
				onDocClick={closeSidebar}
				onDuplicate={async doc => {
					await makeDuplicate(db, doc, ownerId, spaceId, navigate)()
					closeSidebar()
				}}
				onDelete={async doc => {
					await db
						.update(app.documents, doc.id, { deletedAt: new Date() })
						.wait({ tier: "local" })
					if (doc.id === docId)
						void navigate({ to: "/spaces/$spaceId", params: { spaceId } })
				}}
				onCreateFolder={path => newDocument(makeFolderDocumentContent(path))}
				onImport={files => handleImportFiles(files, db, ownerId, { spaceId })}
			/>
		</ListSidebar>
	)
}
