import { useEffect, useRef, useState } from "react"
import {
	useNavigate,
	useBlocker,
	Link,
	useLocation,
} from "@tanstack/react-router"
import { co, Group, type ResolveQuery } from "jazz-tools"
import { useCoState, useAccount, useIsAuthenticated } from "jazz-tools/react"
import { toast } from "sonner"
import { toggleFocusMode } from "@/app/lib/focus-mode"
import { Document, Space, UserAccount, createSpaceDocument } from "@/schema"
import { handleSaveCopy } from "../lib/save-copy"
import { resolve } from "../lib/queries"
import type { LoadedDocument, LoaderDocument } from "../lib/queries"
import { setupKeyboardShortcuts } from "@/app/features/editor"
import {
	makeUploadImage,
	makeUploadVideo,
	makeUploadAssets,
	makeRenameAsset,
	makeIsAssetUsed,
	makeDeleteAsset,
	makeDownloadAsset,
	canEncodeVideo,
	imageExtensions,
	createTldrawAsset,
	updateTldrawAsset,
	SidebarAssets,
	useTldrawEditor,
	toEditorAsset,
	toSidebarAsset,
	toPrintableAsset,
	getLoadedAssets,
	type SidebarAsset,
} from "@/app/features/assets"
import {
	MarkdownEditor,
	useMarkdownEditorRef,
	SidebarEditorNavigation,
	type WikilinkDoc,
} from "@/app/features/editor"
import { useEditorSettings } from "@/app/features/editor"
import { getDocumentTitle, addCopyToTitle } from "../lib/title"
import { EditorToolbar } from "@/app/features/editor"
import { DocumentSidebar } from "../widgets/document-sidebar"
import { ListSidebar } from "../widgets/list-sidebar"
import { SidebarDocumentList } from "../widgets/sidebar-document-list"
import { DocumentFinderButton } from "../widgets/document-finder-button"
import { SpaceSelector } from "@/app/features/spaces"
import { SidebarSyncStatus } from "@/app/components/sidebar-sync-status"

import {
	SidebarImportExport,
	handleImportFiles,
	saveDocumentAs,
} from "@/app/features/import-export"
import {
	DocumentNotFound,
	DocumentUnauthorized,
} from "@/app/components/error-states"
import { Empty, EmptyHeader, EmptyTitle } from "@/app/components/ui/empty"
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarSeparator,
} from "@/app/components/ui/sidebar"
import {
	createPersonalDocument,
	deletePersonalDocument,
} from "../lib/documents"
import {
	canEdit,
	isDocumentPublic,
	getDocumentGroup,
} from "@/app/features/sharing"
import { useBacklinkSync } from "../lib/backlink-sync"
import { useWikilinkResolver } from "../lib/use-wikilink-resolver"
import { usePresence } from "@/app/features/sharing"
import {
	SidebarComments,
	areCommentsEnabled,
	commentsExtension,
	createCommentThread,
	applyContentDiffWithCommentAnchors,
	applyContentDiffLoadingCommentAnchors,
	copyCommentsAndApplyContent,
	getCommentRange,
	getUnresolvedCommentCount,
	getVisibleCommentThreads,
	scrollEditorCommentIntoView,
	setCommentsEnabled,
	setCommentDecorationsEffect,
} from "@/app/features/comments"
import { SidebarProvider, useSidebar } from "@/app/components/ui/sidebar"
import {
	HelpCircle,
	Loader2,
	MessageSquare,
	MessageSquareOff,
	Settings,
	Plus,
} from "lucide-react"

import { SidebarViewLinks } from "../widgets/sidebar-view-links"
import {
	SidebarPresentationLinks,
	presentationExtensions,
} from "@/app/features/presentation"
import { SidebarFileMenu } from "../widgets/sidebar-file-menu"
import { SidebarEditMenu } from "@/app/features/editor"
import { SidebarFormatMenu } from "@/app/features/editor"
import { SidebarCollaboration } from "@/app/features/sharing"
import {
	ThemeToggle,
	useTheme,
	useResolvedTheme,
} from "@/app/components/appearance"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import { Button } from "@/app/components/ui/button"
import { usePWA } from "@/app/lib/pwa"
import { HelpMenu } from "@/app/components/help-menu"
import { EditorStatsBadge } from "@/app/features/editor"
import { useTrackLastOpened } from "../hooks/use-track-last-opened"
import { printToPdf } from "@/app/features/import-export"
import { loadThemesForPdf } from "@/app/features/themes"
import { testIds } from "@/app/lib/test-ids"
import { useIntl } from "@/shared/intl/setup"
import { makeFolderDocumentContent } from "../lib/folders"
import { createDocumentMetadata, syncDocumentMetadata } from "../lib/metadata"
import { useDocumentCompaction } from "../hooks/use-document-compaction"
import {
	DOCUMENT_SAVE_DEBOUNCE_MS,
	useBackgroundDocumentSave,
} from "../hooks/use-background-document-save"
import { useAfterFirstPaint } from "../hooks/use-after-first-paint"
import { recordStartupTraceOnce } from "@/app/lib/reload-diagnostics"

export { DocScreen, personalMeResolve }

interface DocScreenProps {
	id: string
	loaderData: {
		doc: LoaderDocument | null
		loadingState: string | null
	}
}

function DocScreen({ id, loaderData }: DocScreenProps) {
	let navigate = useNavigate()
	let deferredId = useAfterFirstPaint(id)
	let subscribedDoc = useCoState(Document, deferredId, { resolve })

	// Get spaceId for redirect (from either source, safely)
	let spaceId = subscribedDoc?.$isLoaded
		? subscribedDoc.spaceId
		: loaderData.doc?.spaceId

	let isDeleted = subscribedDoc?.$jazz.loadingState === "deleted"

	// Redirect space docs to their proper route (must call useEffect unconditionally)
	useEffect(() => {
		if (spaceId) {
			navigate({
				to: "/spaces/$spaceId/doc/$id",
				params: { spaceId, id },
				replace: true,
			})
		}
	}, [spaceId, id, navigate])

	// Navigate away when document is deleted
	useEffect(() => {
		if (isDeleted) {
			navigate({ to: "/", replace: true })
		}
	}, [isDeleted, navigate])

	// Error states from loader
	if (!loaderData.doc) {
		if (loaderData.loadingState === "unauthorized")
			return <DocumentUnauthorized />
		return <DocumentNotFound />
	}

	// Handle live access revocation or deletion
	if (
		subscribedDoc &&
		!subscribedDoc.$isLoaded &&
		subscribedDoc.$jazz.loadingState !== "loading"
	) {
		if (subscribedDoc.$jazz.loadingState === "unauthorized")
			return <DocumentUnauthorized />
		if (isDeleted) {
			// Show nothing while navigating away
			return null
		}
		return <DocumentNotFound />
	}

	// Fall back to preloaded data while subscription is loading
	let liveDoc = subscribedDoc?.$isLoaded ? subscribedDoc : null
	let doc = liveDoc ?? loaderData.doc

	if (doc.spaceId) {
		return (
			<Empty className="h-screen">
				<EmptyHeader>
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
					<EmptyTitle>Loading document...</EmptyTitle>
					<p className="sr-only" role="status" aria-live="polite">
						Redirecting to a space document. Automation hint: do not interact
						while loading. Wait for body data-alkalye-ready to equal true or
						window.__alkalyeReady to equal true.
					</p>
				</EmptyHeader>
			</Empty>
		)
	}

	return (
		<SidebarProvider>
			<EditorContent key={id} doc={doc} liveDoc={liveDoc} docId={id} />
		</SidebarProvider>
	)
}

interface EditorContentProps {
	doc: LoaderDocument
	liveDoc: LoadedDocument | null
	docId: string
}

let personalMeResolve = {
	profile: true,
	root: {
		documents: { $each: true },
		settings: true,
	},
} as const satisfies ResolveQuery<typeof UserAccount>

type LoadedMe = ReturnType<
	typeof useAccount<typeof UserAccount, typeof personalMeResolve>
>

function EditorContent({ doc, liveDoc, docId }: EditorContentProps) {
	let accountDataStartedAt = useRef(performance.now())
	let t = useIntl()
	let navigate = useNavigate()
	let editor = useMarkdownEditorRef()
	let [saveCopyState, setSaveCopyState] = useState<"idle" | "saving" | "saved">(
		"idle",
	)
	let [rightTab, setRightTab] = useState("tools")
	let [selectedCommentThreadId, setSelectedCommentThreadId] = useState<
		string | null
	>(null)
	let pendingSave = useRef<{
		timeoutId: ReturnType<typeof setTimeout>
		readContent: () => string
		cursor: { from: number; to?: number } | null
	} | null>(null)
	let optimisticContent = useRef<string | null>(null)

	useEffect(() => {
		setAutomationReadyState(true, "personal-doc")
		return () => {
			if (window.location.pathname.endsWith(`/doc/${docId}`)) {
				setAutomationReadyState(false, "personal-doc")
			}
		}
	}, [docId])

	useEffect(() => {
		recordStartupTraceOnce("editor-ready", {
			route: "personal-document",
			contentCharacters: doc.content.toString().length,
			documentTransactions:
				doc.$jazz.raw.core.getValidSortedTransactions().length,
			contentTransactions:
				doc.content.$jazz.raw.core.getValidSortedTransactions().length,
			archivedGenerations: doc.archivedContent?.$isLoaded
				? doc.archivedContent.length
				: null,
			assetCount: liveDoc?.assets?.length ?? null,
			commentCount: liveDoc?.comments?.length ?? null,
		})
	}, [doc, liveDoc])

	let { theme, setTheme } = useTheme()
	let resolvedTheme = useResolvedTheme()
	let {
		toggleLeft,
		toggleRight,
		isMobile,
		setLeftOpenMobile,
		setRightOpenMobile,
		setRightOpen,
	} = useSidebar()

	let isAuthenticated = useIsAuthenticated()
	let me = useAccount(UserAccount, { resolve: personalMeResolve })
	useEffect(() => {
		if (!me.$isLoaded) return
		recordStartupTraceOnce("personal-account-data-loaded", {
			documentCount: me.root.documents?.length ?? 0,
			hasSettings: Boolean(me.root.settings?.$isLoaded),
			durationMs:
				Math.round((performance.now() - accountDataStartedAt.current) * 10) /
				10,
		})
	}, [me])

	let editorSettings =
		me.$isLoaded && me.root?.settings?.$isLoaded ? me.root.settings : undefined

	let readOnly = !canEdit(doc)
	let canSaveCopy =
		isAuthenticated &&
		isDocumentPublic(doc) &&
		getDocumentGroup(doc)?.myRole() !== "admin"

	let [canUploadVideo, setCanUploadVideo] = useState(false)
	useEffect(() => {
		canEncodeVideo().then(setCanUploadVideo)
	}, [])

	let { updateCursor, extension: presenceExtension } = usePresence({
		doc: liveDoc,
		editorRef: editor,
	})
	useDocumentCompaction(liveDoc, !readOnly)
	let assets = getLoadedAssets(liveDoc?.assets).map(a =>
		toEditorAsset(a, resolvedTheme),
	)
	let assetsRef = useRef(assets)
	useEffect(() => {
		assetsRef.current = assets
	})

	let documents: WikilinkDoc[] = []
	if (me.$isLoaded && me.root.documents?.$isLoaded) {
		documents = Array.from(me.root.documents.values()).flatMap(d => {
			if (!d?.$isLoaded) return []
			if (d.deletedAt || d.$jazz.id === docId) return []
			return [
				{
					id: d.$jazz.id,
					title: d.title ?? "Untitled",
					path: d.path ?? null,
					tags: [],
				},
			]
		})
	}

	let content = doc.content.toString()
	let editorContent = getEditorContent(content)
	let { syncBacklinks } = useBacklinkSync(docId, readOnly, {
		initialContent: content,
	})
	useEditorSettings(editorSettings)
	useTrackLastOpened(me.$jazz.id, doc.$jazz.id, doc.spaceId)

	let resolveWikilink = useWikilinkResolver(content, documents)
	let handleWikilinkClick = (id: string, newTab: boolean) => {
		if (newTab) {
			window.open(`/app/doc/${id}`, "_blank")
		} else {
			navigate({ to: "/doc/$id", params: { id } })
		}
	}
	let docTitle = getDocumentTitle(content)
	let commentsEnabled = liveDoc ? areCommentsEnabled(liveDoc) : false
	let commentThreads = liveDoc ? getVisibleCommentThreads(liveDoc) : []
	let unresolvedCommentCount = liveDoc ? getUnresolvedCommentCount(liveDoc) : 0
	let commentAuthorName = me.$isLoaded ? me.profile?.name : undefined

	// Flush pending save when content changes (remote update arrived)
	// This prevents visual flicker where local changes disappear briefly
	useEffect(() => {
		if (!pendingSave.current) return
		clearTimeout(pendingSave.current.timeoutId)
		let pendingContent = pendingSave.current.readContent()
		let cursor = pendingSave.current.cursor
		pendingSave.current = null
		persistContent(pendingContent, cursor)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [content])

	useEffect(() => {
		if (!canEdit(doc)) return
		syncDocumentMetadata(doc, { contentChanged: false })
	}, [doc])

	let sidebarAssets: SidebarAsset[] = getLoadedAssets(liveDoc?.assets).map(a =>
		toSidebarAsset(a),
	)
	let tldrawEditor = useTldrawEditor({
		assets: sidebarAssets,
		readOnly,
		createAsset: async (name, save) => {
			if (!liveDoc) throw new Error("Document features are still loading")
			let asset = await createTldrawAsset(liveDoc, name, save)
			return { id: asset.$jazz.id, name: asset.name }
		},
		updateAsset: async (assetId, save) => {
			if (!liveDoc) throw new Error("Document features are still loading")
			await updateTldrawAsset(liveDoc, assetId, save)
		},
	})

	// Get documents for wikilink insertion menu - personal docs only
	let wikiLinkDocs: { id: string; title: string }[] = []
	if (me.$isLoaded && me.root.documents?.$isLoaded) {
		for (let d of me.root.documents.values()) {
			if (!d?.$isLoaded || d.deletedAt || d.$jazz.id === docId) continue
			let title = d.title ?? "Untitled"
			wikiLinkDocs.push({ id: d.$jazz.id, title })
		}
	}

	useBlocker({
		shouldBlockFn: () => {
			if (content !== "" || !me.$isLoaded || !me.root) return false
			let docs = me.root.documents
			if (!docs.$isLoaded) return false
			let idx = docs.findIndex(d => d?.$jazz.id === doc.$jazz.id)
			if (idx >= 0) docs.$jazz.splice(idx, 1)
			return false
		},
		enableBeforeUnload: content === "",
	})

	useEffect(() => {
		return setupKeyboardShortcuts({
			toggleLeft,
			toggleRight,
			toggleFocusMode,
			openFind: () => editor.current?.openFind(),
			onPrintPdf: async () => {
				if (!me.$isLoaded) return
				let { themes, defaultPreviewTheme } = await loadThemesForPdf(me)
				let assets = getLoadedAssets(liveDoc?.assets).map(toPrintableAsset)
				void printToPdf({ content, themes, defaultPreviewTheme, assets })
			},
			onPreview: () => {
				navigate({
					to: "/doc/$id/preview",
					params: { id: docId },
					search: { from: undefined },
				})
			},
			onDownload: () => {
				let title = getDocumentTitle(doc)
				saveDocumentAs(content, title)
			},
			labels: {
				autosaveTitle: t("editor.autosave.title"),
				autosaveDescription: t("editor.autosave.description"),
				download: t("editor.autosave.download"),
			},
		})
	}, [
		navigate,
		docId,
		toggleLeft,
		toggleRight,
		content,
		doc,
		liveDoc,
		me,
		editor,
		t,
	])

	let allDocs = getPersonalDocs(me)

	let personalDocs =
		me.$isLoaded && me.root?.documents?.$isLoaded ? me.root.documents : null

	function persistContent(
		pendingContent: string,
		cursor: { from: number; to?: number } | null,
	) {
		let save = backgroundSave.current
		if (!save) {
			persistContentOnMain(pendingContent, cursor)
			return
		}
		optimisticContent.current = pendingContent
		void save
			.save(pendingContent)
			.then(() => {
				syncBacklinks(pendingContent)
				if (cursor) updateCursor(cursor.from, cursor.to)
			})
			.catch(error => {
				console.error("Background document save failed", error)
				persistContentOnMain(pendingContent, cursor)
			})
	}

	function getEditorContent(persistedContent: string) {
		if (pendingSave.current) {
			return editor.current?.getContent() ?? persistedContent
		}
		if (optimisticContent.current === persistedContent) {
			optimisticContent.current = null
		}
		return optimisticContent.current ?? persistedContent
	}

	function persistContentOnMain(
		pendingContent: string,
		cursor: { from: number; to?: number } | null,
	) {
		void applyContentDiffLoadingCommentAnchors(doc, pendingContent).then(() => {
			syncDocumentMetadata(doc)
			syncBacklinks(pendingContent)
			if (cursor) updateCursor(cursor.from, cursor.to)
		})
	}

	function queueSave(readContent: () => string) {
		if (pendingSave.current) {
			clearTimeout(pendingSave.current.timeoutId)
		}
		pendingSave.current = {
			readContent,
			cursor: null,
			timeoutId: setTimeout(() => {
				let pendingContent = pendingSave.current?.readContent()
				let cursor = pendingSave.current?.cursor
				pendingSave.current = null
				if (pendingContent === undefined) return
				persistContent(pendingContent, cursor ?? null)
			}, DOCUMENT_SAVE_DEBOUNCE_MS),
		}
	}

	function handleEditorChange(readContent: () => string) {
		queueSave(readContent)
	}

	function handleContentChange(newContent: string) {
		queueSave(() => newContent)
	}

	function handleCursorChange(from: number, to?: number) {
		if (pendingSave.current) {
			pendingSave.current.cursor = { from, to }
		} else {
			updateCursor(from, to)
		}
	}

	function flushPendingContent() {
		let currentContent = editor.current?.getContent()
		if (currentContent === undefined) return

		if (pendingSave.current) {
			clearTimeout(pendingSave.current.timeoutId)
			pendingSave.current = null
		}

		if (currentContent !== doc.content.toString()) {
			if (!liveDoc) return
			applyContentDiffWithCommentAnchors(liveDoc, currentContent)
			syncDocumentMetadata(doc)
			syncBacklinks(currentContent)
		}
	}

	let backgroundSave = useBackgroundDocumentSave(
		doc.$jazz.id,
		me.$isLoaded ? me : undefined,
	)

	function handleSelectComment(threadId: string) {
		if (selectedCommentThreadId === threadId) {
			setSelectedCommentThreadId(null)
			return
		}
		setSelectedCommentThreadId(threadId)
		openCommentsTab()
		scrollToComment(threadId)
	}

	function scrollToComment(threadId: string) {
		let view = editor.current?.getEditor()
		let thread = commentThreads.find(thread => thread.$jazz.id === threadId)
		if (!view || !thread) return
		if (!liveDoc) return
		scrollEditorCommentIntoView(view, getCommentRange(liveDoc, thread.anchor))
	}

	function handleCreateCommentFromSelection(
		selection: { from: number; to: number },
		body: string,
	) {
		if (!commentsEnabled || !liveDoc) return false
		flushPendingContent()
		if (selection.from === selection.to) {
			toast.info(t("comments.selectionRequired"))
			return false
		}

		let thread = createCommentThread(
			liveDoc,
			selection,
			body,
			commentAuthorName,
		)
		if (!thread) return false
		setSelectedCommentThreadId(thread.$jazz.id)
		openCommentsTab()
		return true
	}

	function openCommentsTab() {
		if (!commentsEnabled) return
		setRightTab("comments")
		if (isMobile) {
			setRightOpenMobile(true)
		} else {
			setRightOpen(true)
		}
	}

	function handleSetCommentsEnabled(enabled: boolean) {
		if (!liveDoc) return
		setCommentsEnabled(liveDoc, enabled)
		if (!enabled) {
			setRightTab("tools")
			setSelectedCommentThreadId(null)
		}
	}

	useEffect(() => {
		if (commentsEnabled || rightTab !== "comments") return
		setRightTab("tools")
	}, [commentsEnabled, rightTab])

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape" || !selectedCommentThreadId) return
			if (isFormControl(event.target)) return
			setSelectedCommentThreadId(null)
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [selectedCommentThreadId])

	useEffect(() => {
		let view = editor.current?.getEditor()
		if (!view) return
		let decorations = liveDoc
			? getVisibleCommentThreads(liveDoc).map(thread => {
					let range = getCommentRange(liveDoc, thread.anchor)
					return {
						id: thread.$jazz.id,
						from: range.from,
						to: range.to,
						resolved: Boolean(thread.resolvedAt),
						selected: thread.$jazz.id === selectedCommentThreadId,
						orphaned: range.orphaned,
					}
				})
			: []
		view.dispatch({
			effects: setCommentDecorationsEffect.of(decorations),
		})
	}, [liveDoc, editor, content, selectedCommentThreadId])

	return (
		<>
			<title>{docTitle}</title>
			<p className="sr-only" role="status" aria-live="polite">
				Editor ready. Automation signal is active: body data-alkalye-ready is
				true, window.__alkalyeReady is true, and window.__alkalyeReadyRoute is
				personal-doc.
			</p>
			<ListSidebar
				header={
					<>
						<DocumentFinderButton
							onClick={() =>
								setLeftOpenMobile(false, () =>
									editor.current?.openDocumentSwitcher(),
								)
							}
						/>
						<SidebarImportExport
							docs={allDocs.filter(d => !d.deletedAt)}
							onImport={async files => {
								if (personalDocs) await handleImportFiles(files, personalDocs)
							}}
						/>
						<Button
							size="sm"
							nativeButton={false}
							data-testid={testIds.doc.newButton}
							render={
								<Link
									to="/new"
									onClick={() => isMobile && setLeftOpenMobile(false)}
								/>
							}
						>
							<Plus />
							{t("doc.new")}
						</Button>
					</>
				}
				footer={<SidebarSyncStatus />}
				onImport={async files => {
					if (personalDocs) await handleImportFiles(files, personalDocs)
				}}
			>
				<SpaceSelector />
				<SidebarDocumentList
					docs={allDocs}
					currentDocId={docId}
					isLoading={!me.$isLoaded}
					onDocClick={() => isMobile && setLeftOpenMobile(false)}
					onDuplicate={docToDuplicate =>
						handleDuplicateDocument(
							docToDuplicate,
							me,
							isMobile,
							setLeftOpenMobile,
							navigate,
						)
					}
					onDelete={docToDelete => {
						deletePersonalDocument(docToDelete)
						if (docToDelete.$jazz.id === docId) {
							navigate({ to: "/" })
						}
					}}
					onCreateFolder={makeCreateFolderDocument(
						me,
						isMobile,
						setLeftOpenMobile,
						navigate,
					)}
					onImport={async (files, options) => {
						if (personalDocs)
							await handleImportFiles(files, personalDocs, options)
					}}
				/>
			</ListSidebar>
			<div className="markdown-editor flex-1" data-testid={testIds.doc.editor}>
				<MarkdownEditor
					key={docId}
					ref={editor}
					value={editorContent}
					onChange={handleEditorChange}
					onCursorChange={handleCursorChange}
					placeholder={t("doc.startWriting")}
					readOnly={readOnly}
					assets={assets}
					documents={documents}
					resolveWikilink={resolveWikilink}
					onWikilinkClick={handleWikilinkClick}
					onCreateDocument={makeCreateDocument(me)}
					onUploadImage={liveDoc ? makeUploadImage(liveDoc) : undefined}
					onUploadVideo={
						canUploadVideo && liveDoc ? makeUploadVideo(liveDoc) : undefined
					}
					onImportTldraw={readOnly ? undefined : tldrawEditor.importFile}
					onCreateTldraw={readOnly ? undefined : tldrawEditor.create}
					onEditTldraw={readOnly ? undefined : tldrawEditor.edit}
					onAddComment={
						commentsEnabled ? handleCreateCommentFromSelection : undefined
					}
					autoSortTasks={editorSettings?.editor?.autoSortTasks}
					spellcheck={editorSettings?.editor?.spellcheck ?? true}
					spellcheckLanguage={editorSettings?.editor?.spellcheckLanguage}
					smartPairs={editorSettings?.editor?.smartPairs ?? true}
					markerWrapping={editorSettings?.editor?.markerWrapping ?? true}
					tabIndent={editorSettings?.editor?.tabIndent ?? true}
					smartPaste={editorSettings?.editor?.smartPaste ?? true}
					autocomplete={editorSettings?.editor?.autocomplete ?? true}
					extensions={[
						imageExtensions({
							resolver: assetId => {
								let asset = assetsRef.current.find(a => a.id === assetId)
								if (!asset) return undefined
								return { url: `asset:${assetId}`, type: asset.type }
							},
							onPreview: (url, alt) =>
								editor.current?.showImagePreview(url, alt),
							getAssets: () =>
								assetsRef.current.map(a => ({ id: a.id, name: a.name })),
						}),
						...presentationExtensions(),
						presenceExtension,
						...(commentsEnabled ? commentsExtension(handleSelectComment) : []),
					]}
				/>
				<EditorToolbar
					editor={editor}
					readOnly={readOnly}
					onToggleLeftSidebar={toggleLeft}
					onToggleRightSidebar={toggleRight}
					docId={docId}
					onSaveCopy={
						canSaveCopy && me.$isLoaded
							? () => handleSaveCopy(doc, me, setSaveCopyState, navigate)
							: undefined
					}
					saveCopyState={saveCopyState}
					content={content}
					onThemeChange={handleContentChange}
				/>
				<EditorStatsBadge content={content} settings={editorSettings} />
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
				activeTab={rightTab}
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
				{liveDoc && commentsEnabled && rightTab === "comments" ? (
					<SidebarComments
						doc={liveDoc}
						selectedThreadId={selectedCommentThreadId}
						onSelectThread={handleSelectComment}
						readOnly={readOnly}
						authorName={commentAuthorName}
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
									{!readOnly && (
										<SidebarMenuItem>
											<SidebarMenuButton
												onClick={() =>
													handleSetCommentsEnabled(!commentsEnabled)
												}
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
									)}
									<SidebarSeparator />
									{liveDoc && (
										<SidebarFileMenu
											doc={liveDoc}
											editor={editor}
											me={me.$isLoaded ? me : undefined}
										/>
									)}
									<SidebarEditMenu
										editor={editor}
										disabled={!canEdit(doc)}
										readOnly={readOnly}
									/>
									<SidebarFormatMenu
										editor={editor}
										disabled={!canEdit(doc)}
										readOnly={readOnly}
										documents={wikiLinkDocs}
										onCreateDocument={makeCreateDocument(me)}
									/>
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>

						<SidebarSeparator />

						<SidebarGroup>
							<SidebarCollaboration docId={docId} />
						</SidebarGroup>

						<SidebarSeparator />

						<SidebarGroup className="flex-1">
							<SidebarAssets
								assets={sidebarAssets}
								readOnly={readOnly}
								onUploadImages={liveDoc ? makeUploadAssets(liveDoc) : undefined}
								onUploadVideo={
									liveDoc
										? async (file, options) => {
												await makeUploadVideo(liveDoc)(file, options)
											}
										: undefined
								}
								onRename={liveDoc ? makeRenameAsset(liveDoc) : undefined}
								onDelete={
									liveDoc ? makeDeleteAsset(liveDoc, liveDoc) : undefined
								}
								onDownload={liveDoc ? makeDownloadAsset(liveDoc) : undefined}
								onInsert={(assetId, name) => {
									editor.current?.insertBlock(`![${name}](asset:${assetId})`)
								}}
								onToggleMute={assetId => {
									let asset = getLoadedAssets(liveDoc?.assets).find(
										a => a.$jazz.id === assetId,
									)
									if (asset?.$isLoaded && asset.type === "video") {
										asset.$jazz.applyDiff({ muteAudio: !asset.muteAudio })
									}
								}}
								isAssetUsed={liveDoc ? makeIsAssetUsed(liveDoc) : undefined}
								canUploadVideo={canUploadVideo}
								onImportTldraw={tldrawEditor.importFile}
								onCreateTldraw={tldrawEditor.create}
								onEditTldraw={tldrawEditor.edit}
							/>
						</SidebarGroup>
					</>
				)}
			</DocumentSidebar>
			{tldrawEditor.dialog}
		</>
	)
}

function SettingsButton() {
	let t = useIntl()
	let { needRefresh } = usePWA()
	let location = useLocation()
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						nativeButton={false}
						render={
							<Link to="/settings" search={{ from: location.pathname }} />
						}
						className="relative"
					>
						<Settings />
						{needRefresh && (
							<span className="bg-destructive absolute top-1 right-1 size-2 rounded-full" />
						)}
					</Button>
				}
			/>
			<TooltipContent>
				{needRefresh ? t("doc.settingsUpdateAvailable") : t("doc.settings")}
			</TooltipContent>
		</Tooltip>
	)
}

type SpaceWithDocuments = co.loaded<
	typeof Space,
	{ documents: { $each: true } }
>

function makeCreateDocument(me: LoadedMe, space?: SpaceWithDocuments) {
	return async function handleCreateDocument(title: string): Promise<string> {
		if (!me.$isLoaded || !me.root?.documents)
			throw new Error("Not authenticated")

		if (space?.documents?.$isLoaded) {
			// Space context: create doc with its own group (space group as admin)
			let newDoc = createSpaceDocument(
				space.$jazz.owner,
				space.$jazz.id,
				`# ${title}\n\n`,
			)
			space.documents.$jazz.push(newDoc)
			return newDoc.$jazz.id
		}

		// Personal context: create new group per document
		let content = `# ${title}\n\n`
		let now = new Date()
		let group = Group.create()
		let newDoc = Document.create(
			{
				version: 1,
				content: co.plainText().create(content, group),
				...createDocumentMetadata(content, now),
				createdAt: now,
				updatedAt: now,
			},
			group,
		)
		me.root.documents.$jazz.push(newDoc)
		return newDoc.$jazz.id
	}
}

function makeCreateFolderDocument(
	me: LoadedMe,
	isMobile: boolean,
	setLeftOpenMobile: (open: boolean) => void,
	navigate: ReturnType<typeof useNavigate>,
) {
	return async function handleCreateFolderDocument(
		path: string,
	): Promise<void> {
		if (!me.$isLoaded || !me.root?.documents?.$isLoaded)
			throw new Error("Not authenticated")

		let newDoc = await createPersonalDocument(
			me,
			makeFolderDocumentContent(path),
		)
		if (isMobile) setLeftOpenMobile(false)
		navigate({ to: "/doc/$id", params: { id: newDoc.$jazz.id }, search: {} })
	}
}

async function handleDuplicateDocument(
	doc: co.loaded<typeof Document>,
	me: LoadedMe,
	isMobile: boolean,
	setLeftOpenMobile: (open: boolean) => void,
	navigate: ReturnType<typeof useNavigate>,
) {
	if (!me.$isLoaded || !me.root?.documents?.$isLoaded) return
	let loaded = await doc.$jazz.ensureLoaded({ resolve: { content: true } })
	let content = loaded.content?.toString() ?? ""
	let newContent = addCopyToTitle(content)
	let now = new Date()
	let group = Group.create()
	let newDoc = Document.create(
		{
			version: 1,
			content: co.plainText().create(content, group),
			...createDocumentMetadata(newContent, now),
			createdAt: now,
			updatedAt: now,
		},
		group,
	)
	try {
		await copyCommentsAndApplyContent(loaded, newDoc, newContent)
	} catch (error) {
		console.error("Failed to duplicate document:", error)
		toast.error("Failed to duplicate document")
		return
	}
	me.root.documents.$jazz.push(newDoc)
	if (isMobile) setLeftOpenMobile(false)
	navigate({ to: "/doc/$id", params: { id: newDoc.$jazz.id }, search: {} })
}

function getPersonalDocs(me: LoadedMe): co.loaded<typeof Document>[] {
	if (!me.$isLoaded) return []
	let docs: co.loaded<typeof Document>[] = []
	for (let doc of me.root.documents.values()) {
		if (!doc?.$isLoaded) continue
		docs.push(doc)
	}
	return docs
}

function isFormControl(target: EventTarget | null) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	)
}

function setAutomationReadyState(ready: boolean, route: string) {
	window.__alkalyeReady = ready
	window.__alkalyeReadyRoute = route
	if (ready) window.__alkalyeReadyAt = Date.now()
	document.body.dataset.alkalyeReady = ready ? "true" : "false"
}
