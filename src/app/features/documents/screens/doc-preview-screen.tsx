import {
	useEffect,
	useState,
	type FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useCoState, useAccount } from "jazz-tools/react"
import { type ResolveQuery } from "jazz-tools"
import { toast } from "sonner"
import { Document, UserAccount } from "@/schema"
import { getDocumentTitle } from "../lib/title"
import {
	getShortcutLabel,
	isShortcutEvent,
	isShortcutTargetBlocked,
} from "@/app/lib/shortcut-registry"
import {
	EllipsisIcon,
	MessageSquare,
	MessageSquarePlus,
	Pencil,
} from "lucide-react"
import {
	DocumentNotFound,
	DocumentUnauthorized,
} from "@/app/components/error-states"

import { Button } from "@/app/components/ui/button"
import { Textarea } from "@/app/components/ui/textarea"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import { useTheme, ThemeSubmenu } from "@/app/components/appearance"
import { Preview } from "../widgets/preview"
import { parseFrontmatter, parseWikiLinks } from "@/app/features/editor"
import {
	SidebarComments,
	areCommentsEnabled,
	createCommentThread,
	getCommentRange,
	getUnresolvedCommentCount,
	getVisibleCommentThreads,
} from "@/app/features/comments"
import { canEdit } from "@/app/features/sharing"
import {
	resolveDocTitles,
	useDocTitles,
	type ResolvedDoc,
} from "../lib/wikilink-titles"
import {
	buildPreviewTextMap,
	rawRangeToRenderedRange,
	renderedRangeToRawRange,
} from "../lib/preview-text-map"
import {
	countOccurrences,
	findBestTextOccurrence,
} from "../lib/comment-text-match"
import { printToPdf } from "@/app/features/import-export"
import { useIntl } from "@/shared/intl/setup"
import { assetPreviewResolve } from "@/app/features/assets"

export { DocPreviewScreen, previewResolve, resolveDocTitles }

let previewResolve = {
	content: true,
	assets: {
		$each: assetPreviewResolve,
	},
	comments: { $each: { replies: true } },
} as const satisfies ResolveQuery<typeof Document>

let themesResolve = {
	profile: true,
	root: {
		settings: true,
		themes: {
			$each: { css: true, template: true, assets: { $each: { data: true } } },
		},
	},
} as const

interface DocPreviewScreenProps {
	id: string
	loaderData: {
		doc:
			| import("jazz-tools").co.loaded<typeof Document, typeof previewResolve>
			| null
		loadingState: string | null
		wikilinkCache: Map<string, ResolvedDoc>
	}
}

type PreviewSelection = {
	text: string
	occurrence: number
	renderedFrom: number
	renderedTo: number
	contextBefore: string
	contextAfter: string
}

function DocPreviewScreen({ id, loaderData }: DocPreviewScreenProps) {
	let t = useIntl()
	let navigate = useNavigate()
	let [commentsOpen, setCommentsOpen] = useState(false)
	let [selectedCommentThreadId, setSelectedCommentThreadId] = useState<
		string | null
	>(null)
	let [previewSelection, setPreviewSelection] =
		useState<PreviewSelection | null>(null)
	let [pendingCommentQuote, setPendingCommentQuote] = useState("")
	let [commentDialogOpen, setCommentDialogOpen] = useState(false)
	let [commentBody, setCommentBody] = useState("")

	let subscribedDoc = useCoState(Document, id, { resolve: previewResolve })
	let meWithThemes = useAccount(UserAccount, { resolve: themesResolve })

	// Extract content for wikilinks (use loader data as fallback, empty if neither)
	let content =
		(subscribedDoc.$isLoaded
			? subscribedDoc
			: loaderData.doc
		)?.content?.toString() ?? ""
	let parsedContent = parseContentBody(content)
	let wikilinkIds = parseWikiLinks(content).map(w => w.id)
	let wikilinkCache = useDocTitles(wikilinkIds, loaderData.wikilinkCache)
	let previewTextMap = buildPreviewTextMap(parsedContent.body, docId => {
		return wikilinkCache.get(docId) ?? { title: docId, exists: false }
	})
	let previewDoc = subscribedDoc.$isLoaded ? subscribedDoc : loaderData.doc
	let commentsEnabled = previewDoc ? areCommentsEnabled(previewDoc) : false
	let canAddPreviewComment = Boolean(
		previewDoc && commentsEnabled && canEdit(previewDoc),
	)

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape" && selectedCommentThreadId) {
				if (isFormControl(e.target)) return
				setSelectedCommentThreadId(null)
				return
			}

			if (e.defaultPrevented || isShortcutTargetBlocked(e.target)) return

			if (isShortcutEvent(e, "print")) {
				e.preventDefault()
				void printToPdf({
					content,
					themes: meWithThemes.$isLoaded
						? meWithThemes.root?.themes
						: undefined,
					defaultPreviewTheme: meWithThemes.$isLoaded
						? (meWithThemes.root?.settings?.defaultPreviewTheme ?? null)
						: null,
				})
				return
			}

			if (isShortcutEvent(e, "comment")) {
				if (!canAddPreviewComment) return
				e.preventDefault()
				let currentSelection = window.getSelection()?.toString().trim()
				let selection =
					previewSelection ??
					(currentSelection
						? {
								text: currentSelection,
								occurrence: 0,
								renderedFrom: 0,
								renderedTo: currentSelection.length,
								contextBefore: "",
								contextAfter: "",
							}
						: null)
				if (!selection?.text.trim()) {
					toast.info(t("comments.selectionRequired"))
					return
				}
				setPreviewSelection(selection)
				setPendingCommentQuote(selection.text)
				setCommentDialogOpen(true)
			}
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [
		canAddPreviewComment,
		content,
		meWithThemes,
		previewSelection,
		selectedCommentThreadId,
		t,
	])

	// Error states from loader
	if (!loaderData.doc) {
		if (loaderData.loadingState === "unauthorized")
			return <DocumentUnauthorized />
		return <DocumentNotFound />
	}

	// Handle live access revocation
	if (
		!subscribedDoc.$isLoaded &&
		subscribedDoc.$jazz.loadingState !== "loading"
	) {
		if (subscribedDoc.$jazz.loadingState === "unauthorized")
			return <DocumentUnauthorized />
		return <DocumentNotFound />
	}

	if (!previewDoc) return <DocumentNotFound />

	let doc = previewDoc
	let assets = doc.assets?.filter(a => a?.$isLoaded) ?? []
	let docTitle = getDocumentTitle(content)
	let commentThreads = getVisibleCommentThreads(doc)
	let unresolvedCommentCount = getUnresolvedCommentCount(doc)
	let readOnly = !canEdit(doc)
	let commentAuthorName = meWithThemes.$isLoaded
		? meWithThemes.profile?.name
		: undefined

	function handleSelectComment(threadId: string) {
		if (!commentsEnabled) return
		if (selectedCommentThreadId === threadId) {
			setSelectedCommentThreadId(null)
			return
		}
		setSelectedCommentThreadId(threadId)
		setCommentsOpen(true)
	}

	function handleCreateCommentFromQuote(
		selection: PreviewSelection,
		body: string,
	) {
		if (!commentsEnabled) return false
		if (!selection.text.trim()) {
			toast.info(t("comments.selectionRequired"))
			return false
		}

		let range = getPreviewSelectionRange(selection)
		let thread = range
			? createCommentThread(doc, range, body, commentAuthorName)
			: null
		if (!thread) {
			toast.info(t("comments.selectionNotFound"))
			return false
		}

		setSelectedCommentThreadId(thread.$jazz.id)
		setCommentsOpen(true)
		window.getSelection()?.removeAllRanges()
		return true
	}

	function openCommentDialog() {
		if (!commentsEnabled) return
		if (!previewSelection?.text.trim()) {
			toast.info(t("comments.selectionRequired"))
			return
		}
		setPendingCommentQuote(previewSelection.text)
		setCommentDialogOpen(true)
	}

	function handleCommentDialogOpenChange(open: boolean) {
		setCommentDialogOpen(open)
		if (!open) {
			setCommentBody("")
			setPendingCommentQuote("")
		}
	}

	function submitPreviewComment(event?: FormEvent) {
		event?.preventDefault()
		if (!previewSelection || !pendingCommentQuote || !commentBody.trim()) return
		if (handleCreateCommentFromQuote(previewSelection, commentBody)) {
			setCommentBody("")
			setPendingCommentQuote("")
			setCommentDialogOpen(false)
		}
	}

	function handleCommentKeyDown(
		event: ReactKeyboardEvent<HTMLTextAreaElement>,
	) {
		if (event.key !== "Enter" || event.shiftKey) return
		event.preventDefault()
		submitPreviewComment()
	}

	function getPreviewSelectionRange(selection: PreviewSelection) {
		let text = selection.text.trim()
		let mapped = renderedRangeToRawRange(
			previewTextMap,
			selection.renderedFrom,
			selection.renderedTo,
		)
		if (mapped) {
			return {
				from: parsedContent.start + mapped.from,
				to: parsedContent.start + mapped.to,
			}
		}

		let from = findBestTextOccurrence(parsedContent.body, text, selection)
		if (from < 0) return null
		return {
			from: parsedContent.start + from,
			to: parsedContent.start + from + text.length,
		}
	}

	function getPreviewComment(thread: (typeof commentThreads)[number]) {
		let range = getCommentRange(doc, thread.anchor)
		let rawFrom = range.from - parsedContent.start
		let rendered =
			range.orphaned || rawFrom < 0
				? null
				: rawRangeToRenderedRange(
						previewTextMap,
						rawFrom,
						range.to - parsedContent.start,
					)
		let occurrence =
			!range.orphaned && rawFrom >= 0
				? countPreviewCommentOccurrence(thread, rawFrom, rendered)
				: -1
		return {
			id: thread.$jazz.id,
			quote: rendered?.text || thread.anchor.quote,
			contextBefore: thread.anchor.contextBefore,
			contextAfter: thread.anchor.contextAfter,
			occurrence,
			renderedFrom: rendered?.from ?? null,
			renderedTo: rendered?.to ?? null,
			resolved: Boolean(thread.resolvedAt),
			selected: thread.$jazz.id === selectedCommentThreadId,
		}
	}

	function countPreviewCommentOccurrence(
		thread: (typeof commentThreads)[number],
		rawFrom: number,
		rendered: ReturnType<typeof rawRangeToRenderedRange>,
	) {
		if (rendered) {
			return countOccurrences(
				previewTextMap.text.slice(0, rendered.from),
				rendered.text,
			)
		}
		return countOccurrences(
			parsedContent.body.slice(0, rawFrom),
			thread.anchor.quote,
		)
	}

	return (
		<div className="bg-background fixed inset-0 flex flex-col">
			<TopBar
				id={id}
				docTitle={docTitle}
				commentsEnabled={commentsEnabled}
				commentsOpen={commentsEnabled && commentsOpen}
				unresolvedCommentCount={unresolvedCommentCount}
				onToggleComments={() => setCommentsOpen(open => !open)}
			/>
			<div className="relative flex min-h-0 flex-1">
				<Preview
					content={content}
					assets={assets}
					wikilinks={wikilinkCache}
					onExit={() => navigate({ to: "/doc/$id", params: { id } })}
					comments={
						commentsEnabled
							? commentThreads.map(thread => getPreviewComment(thread))
							: []
					}
					onCommentSelect={handleSelectComment}
					onTextSelectionChange={
						commentsEnabled ? setPreviewSelection : undefined
					}
				/>
				{commentsEnabled && commentsOpen && (
					<aside className="border-border bg-sidebar text-sidebar-foreground absolute inset-0 z-10 flex w-full border-l-0 md:relative md:w-[22rem] md:shrink-0 md:border-l">
						<SidebarComments
							doc={doc}
							selectedThreadId={selectedCommentThreadId}
							onSelectThread={handleSelectComment}
							readOnly={readOnly}
							authorName={commentAuthorName}
						/>
					</aside>
				)}
			</div>
			{commentsEnabled &&
				!readOnly &&
				previewSelection?.text.trim() &&
				!commentDialogOpen && (
					<Button
						variant="brand"
						size="icon-lg"
						className="fixed right-4 bottom-4 z-20 shadow-lg"
						style={{
							right: "calc(1rem + env(safe-area-inset-right))",
							bottom: "calc(1rem + env(safe-area-inset-bottom))",
						}}
						aria-label={t("comments.add")}
						onClick={openCommentDialog}
					>
						<MessageSquarePlus />
					</Button>
				)}
			<Dialog
				open={commentsEnabled && commentDialogOpen}
				onOpenChange={handleCommentDialogOpenChange}
			>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>{t("comments.add")}</DialogTitle>
						<DialogDescription className="line-clamp-3">
							{pendingCommentQuote || t("comments.selectionRequired")}
						</DialogDescription>
					</DialogHeader>
					<form className="space-y-3" onSubmit={submitPreviewComment}>
						<Textarea
							value={commentBody}
							onChange={event => setCommentBody(event.target.value)}
							onKeyDown={handleCommentKeyDown}
							placeholder={t("comments.newPlaceholder")}
							minRows={3}
						/>
						<Button
							type="submit"
							className="w-full"
							disabled={!pendingCommentQuote || !commentBody.trim()}
						>
							<MessageSquarePlus />
							{t("comments.add")}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	)
}

function TopBar({
	id,
	docTitle,
	commentsEnabled,
	commentsOpen,
	unresolvedCommentCount,
	onToggleComments,
}: {
	id: string
	docTitle: string
	commentsEnabled: boolean
	commentsOpen: boolean
	unresolvedCommentCount: number
	onToggleComments: () => void
}) {
	let { theme, setTheme } = useTheme()

	return (
		<div
			className="border-border relative flex shrink-0 items-center justify-between border-b px-4 py-2"
			style={{
				paddingTop: "max(0.5rem, env(safe-area-inset-top))",
				paddingLeft: "max(1rem, env(safe-area-inset-left))",
				paddingRight: "max(1rem, env(safe-area-inset-right))",
			}}
		>
			<Button
				variant="ghost"
				size="sm"
				nativeButton={false}
				render={<Link to="/doc/$id" params={{ id }} />}
			>
				Editor
			</Button>
			<span className="text-muted-foreground absolute left-1/2 -translate-x-1/2 truncate text-sm font-medium">
				{docTitle}
			</span>
			<div className="flex items-center gap-1">
				{commentsEnabled && (
					<Button
						variant={commentsOpen ? "secondary" : "ghost"}
						size="icon"
						onClick={onToggleComments}
						aria-label="Comments"
						className="relative"
					>
						<MessageSquare className="size-4" />
						{unresolvedCommentCount > 0 && (
							<span className="bg-brand text-brand-foreground absolute -mt-5 ml-5 rounded px-1 text-[10px]">
								{unresolvedCommentCount}
							</span>
						)}
					</Button>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button variant="ghost" size="icon" nativeButton={false}>
								<EllipsisIcon className="size-4" />
							</Button>
						}
					/>
					<DropdownMenuContent align="end">
						<DropdownMenuItem render={<Link to="/doc/$id" params={{ id }} />}>
							<Pencil className="size-4" />
							Editor
							<DropdownMenuShortcut>
								{getShortcutLabel("preview")}
							</DropdownMenuShortcut>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<ThemeSubmenu theme={theme} setTheme={setTheme} />
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	)
}

function isFormControl(target: EventTarget | null) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	)
}

function parseContentBody(content: string) {
	let { body } = parseFrontmatter(content)
	return {
		body,
		start: content.length - body.length,
	}
}
