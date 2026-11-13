import {
	useEffect,
	useState,
	type FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { toast } from "sonner"
import { useOne } from "jazz-tools/react"
import { app, type DocumentRow } from "@/jazz/schema"
import { useLibrary } from "../lib/library"
import {
	useComments,
	SidebarComments,
	areCommentsEnabled,
	getVisibleCommentThreads,
	getUnresolvedCommentCount,
	getCommentRange,
	createCommentThread,
} from "@/app/features/comments"
import { parseFrontmatter } from "@/app/features/editor"
import {
	buildPreviewTextMap,
	rawRangeToRenderedRange,
	renderedRangeToRawRange,
} from "../lib/preview-text-map"
import {
	countOccurrences,
	findBestTextOccurrence,
} from "../lib/comment-text-match"
import { useIntl } from "@/shared/intl/setup"
import {
	isModEnterEvent,
	isShortcutEvent,
	isShortcutTargetBlocked,
	getActiveShortcutPlatform,
} from "@/app/lib/shortcut-registry"
import { Kbd } from "@/app/components/ui/kbd"
import { Textarea } from "@/app/components/ui/textarea"
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/app/components/ui/dialog"
import { type PreviewProps } from "../widgets/preview"
type PreviewSelection = NonNullable<
	Parameters<NonNullable<PreviewProps["onTextSelectionChange"]>>[0]
>
import { MessageSquarePlus } from "lucide-react"
import { EllipsisIcon, MessageSquare, Pencil } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import { useTheme, ThemeSubmenu } from "@/app/components/appearance"
import { getShortcutLabel } from "@/app/lib/shortcut-registry"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import { Link, useNavigate } from "@tanstack/react-router"
import { Preview } from "../widgets/preview"
import { DocumentNotFound } from "@/app/components/error-states"
export { DocPreviewScreen }
function DocPreviewScreen({ id }: { id: string }) {
	let { data: doc, isLoading } = useOne(app.documents.where({ id }))
	if (isLoading) return <p role="status">Opening document…</p>
	if (!doc || doc.deletedAt) return <DocumentNotFound />
	return <PreviewContent key={id} id={id} doc={doc} />
}
function PreviewContent({ id, doc }: { id: string; doc: DocumentRow }) {
	let { documents, ownerId, grants, profile } = useLibrary()
	let t = useIntl(),
		navigate = useNavigate()
	let commentDoc = useComments(doc)
	let content = doc.content,
		docTitle = doc.title
	let parsedContent = parseContentBody(content),
		previewTextMap = buildPreviewTextMap(parsedContent.body)
	let commentsEnabled = areCommentsEnabled(commentDoc)
	let commentThreads = getVisibleCommentThreads(commentDoc),
		unresolvedCommentCount = getUnresolvedCommentCount(commentDoc)
	let readOnly =
		doc.ownerId !== ownerId &&
		!grants.some(grant => grant.documentId === id && grant.role !== "reader")
	let commentAuthorName = profile?.name
	let [commentsOpen, setCommentsOpen] = useState(false)
	let [selectedCommentThreadId, setSelectedCommentThreadId] = useState<
		string | null
	>(null)
	let [previewSelection, setPreviewSelection] =
		useState<PreviewSelection | null>(null)
	let [commentDialogOpen, setCommentDialogOpen] = useState(false)
	let [commentBody, setCommentBody] = useState(""),
		[pendingCommentQuote, setPendingCommentQuote] = useState("")
	let wikilinks = new Map(
		documents.map(doc => [
			doc.id,
			{ id: doc.id, title: doc.title, exists: !doc.deletedAt },
		]),
	)
	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape" && selectedCommentThreadId) {
				if (isShortcutTargetBlocked(event.target)) return
				setSelectedCommentThreadId(null)
				return
			}
			if (
				event.defaultPrevented ||
				isShortcutTargetBlocked(event.target) ||
				!isShortcutEvent(event, "comment") ||
				readOnly ||
				!commentsEnabled
			)
				return
			event.preventDefault()
			if (!previewSelection?.text.trim()) {
				toast.info(t("comments.selectionRequired"))
				return
			}
			setPendingCommentQuote(previewSelection.text)
			setCommentDialogOpen(true)
		}
		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [selectedCommentThreadId, commentsEnabled, readOnly, previewSelection, t])

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
			? createCommentThread(commentDoc, range, body, commentAuthorName)
			: null
		if (!thread) {
			toast.info(t("comments.selectionNotFound"))
			return false
		}

		setSelectedCommentThreadId(thread.id)
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
		if (!isModEnterEvent(event.nativeEvent)) return
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
		let range = getCommentRange(commentDoc, thread.anchor)
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
			id: thread.id,
			quote: rendered?.text || thread.anchor.quote,
			contextBefore: thread.anchor.contextBefore,
			contextAfter: thread.anchor.contextAfter,
			occurrence,
			renderedFrom: rendered?.from ?? null,
			renderedTo: rendered?.to ?? null,
			resolved: Boolean(thread.resolvedAt),
			selected: thread.id === selectedCommentThreadId,
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
					assets={[]}
					wikilinks={wikilinks}
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
							doc={commentDoc}
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
							aria-keyshortcuts="Meta+Enter Control+Enter"
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
							<Kbd className="ml-auto">
								{getActiveShortcutPlatform() === "mac" ? "⌘↵" : "Ctrl+Enter"}
							</Kbd>
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

function parseContentBody(content: string) {
	let { body } = parseFrontmatter(content)
	return { body, start: content.length - body.length }
}
