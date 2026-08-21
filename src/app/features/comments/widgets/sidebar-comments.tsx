import { useState, type FormEvent, type KeyboardEvent } from "react"
import {
	Check,
	ChevronDown,
	ChevronRight,
	MessageSquarePlus,
	MoreHorizontal,
	RotateCcw,
	Trash2,
} from "lucide-react"
import { Button } from "@/app/components/ui/button"
import { Kbd } from "@/app/components/ui/kbd"
import { Textarea } from "@/app/components/ui/textarea"
import { Badge } from "@/app/components/ui/badge"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/app/components/ui/context-menu"
import { useHasFinePointer } from "@/app/hooks/use-fine-pointer"
import { cn } from "@/app/lib/cn"
import { useIntl } from "@/shared/intl/setup"
import {
	getActiveShortcutPlatform,
	isModEnterEvent,
} from "@/app/lib/shortcut-registry"
import {
	addCommentReply,
	deleteCommentThread,
	getCommentRange,
	getVisibleCommentThreads,
	reopenCommentThread,
	resolveCommentThread,
	type LoadedCommentDocument,
} from "../lib/comments"

export { SidebarComments }

type SidebarCommentsProps = {
	doc: LoadedCommentDocument
	selectedThreadId: string | null
	onSelectThread: (threadId: string) => void
	readOnly?: boolean
	authorName?: string
}

function SidebarComments({
	doc,
	selectedThreadId,
	onSelectThread,
	readOnly,
	authorName,
}: SidebarCommentsProps) {
	let t = useIntl()
	let threads = getVisibleCommentThreads(doc)
	let unresolved = threads.filter(thread => !thread.resolvedAt)
	let resolved = threads.filter(thread => thread.resolvedAt)

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="border-border border-b px-3 py-2">
				<div className="flex items-center justify-between gap-2">
					<div className="text-sm font-medium">{t("comments.title")}</div>
					<Badge variant="outline" className="h-5 gap-1 px-1.5 text-[11px]">
						{unresolved.length}
					</Badge>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{threads.length === 0 ? (
					<div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
						<MessageSquarePlus className="size-6 opacity-60" />
						<p>{t("comments.empty")}</p>
					</div>
				) : (
					<div className="space-y-3 p-2">
						<CommentSection
							title={t("comments.unresolved")}
							threads={unresolved}
							doc={doc}
							selectedThreadId={selectedThreadId}
							onSelectThread={onSelectThread}
							readOnly={readOnly}
							authorName={authorName}
						/>
						<CommentSection
							title={t("comments.resolved")}
							threads={resolved}
							doc={doc}
							selectedThreadId={selectedThreadId}
							onSelectThread={onSelectThread}
							readOnly={readOnly}
							authorName={authorName}
						/>
					</div>
				)}
			</div>
		</div>
	)
}

function CommentSection({
	title,
	threads,
	doc,
	selectedThreadId,
	onSelectThread,
	readOnly,
	authorName,
}: {
	title: string
	threads: ReturnType<typeof getVisibleCommentThreads>
	doc: LoadedCommentDocument
	selectedThreadId: string | null
	onSelectThread: (threadId: string) => void
	readOnly?: boolean
	authorName?: string
}) {
	if (threads.length === 0) return null

	return (
		<section className="space-y-1">
			<h3 className="text-muted-foreground flex items-center justify-between px-2 text-[11px] font-medium">
				<span>{title}</span>
				<span className="tabular-nums">{threads.length}</span>
			</h3>
			{threads.map(thread => (
				<CommentThreadItem
					key={thread.$jazz.id}
					doc={doc}
					thread={thread}
					selected={thread.$jazz.id === selectedThreadId}
					onSelect={() => onSelectThread(thread.$jazz.id)}
					readOnly={readOnly}
					authorName={authorName}
				/>
			))}
		</section>
	)
}

function CommentThreadItem({
	doc,
	thread,
	selected,
	onSelect,
	readOnly,
	authorName,
}: {
	doc: LoadedCommentDocument
	thread: ReturnType<typeof getVisibleCommentThreads>[number]
	selected: boolean
	onSelect: () => void
	readOnly?: boolean
	authorName?: string
}) {
	let t = useIntl()
	let hasFinePointer = useHasFinePointer()
	let [collapsed, setCollapsed] = useState(false)
	let [replyOpen, setReplyOpen] = useState(false)
	let [reply, setReply] = useState("")
	let range = getCommentRange(doc, thread.anchor)
	let replies = []
	for (let item of thread.replies.values()) {
		if (item?.$isLoaded && !item.deletedAt) replies.push(item)
	}

	function openReply() {
		setCollapsed(false)
		setReplyOpen(true)
	}

	function handleReply(event?: FormEvent) {
		event?.preventDefault()
		if (!reply.trim()) return
		addCommentReply(thread, reply, authorName)
		setReply("")
		setReplyOpen(false)
	}

	function handleReplyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (!isModEnterEvent(event.nativeEvent)) return
		event.preventDefault()
		handleReply()
	}

	function cancelReply() {
		setReply("")
		setReplyOpen(false)
	}

	return (
		<ContextMenu disabled={readOnly || !hasFinePointer}>
			<ContextMenuTrigger
				onTouchStart={event => event.preventBaseUIHandler()}
				render={
					<article
						className={cn(
							"group rounded-sm px-2 py-2 text-sm",
							"pointer-fine:hover:bg-sidebar-accent/60",
							selected &&
								"bg-sidebar-accent shadow-[inset_2px_0_0_var(--brand)]",
							thread.resolvedAt && "text-muted-foreground",
						)}
					>
						<div className="flex items-start gap-1.5">
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={
									collapsed ? t("comments.expand") : t("comments.collapse")
								}
								className="mt-0.5 shrink-0"
								onClick={() => setCollapsed(value => !value)}
								nativeButton
							>
								{collapsed ? <ChevronRight /> : <ChevronDown />}
							</Button>
							<button
								type="button"
								className="min-h-8 min-w-0 flex-1 text-left"
								onClick={onSelect}
							>
								<blockquote
									className={cn(
										"line-clamp-2 text-xs leading-5",
										selected ? "text-foreground" : "text-muted-foreground",
									)}
								>
									{range.orphaned
										? t("comments.orphaned")
										: thread.anchor.quote}
								</blockquote>
							</button>
							<div className="flex shrink-0 items-center gap-0.5">
								{thread.resolvedAt && (
									<Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
										{t("comments.resolvedBadge")}
									</Badge>
								)}
								{!readOnly && (
									<ThreadActionsMenu thread={thread} onReply={openReply} />
								)}
							</div>
						</div>
						{!collapsed && (
							<div className="mt-1.5 space-y-1.5 pl-6">
								{replies.map(item => (
									<div
										key={item.$jazz.id}
										className="bg-muted/45 rounded-sm px-2 py-1.5"
									>
										<div className="text-muted-foreground mb-0.5 truncate text-[11px]">
											{item.authorName ?? t("comments.unknownAuthor")}
										</div>
										<p className="text-foreground/90 text-xs leading-5 whitespace-pre-wrap">
											{item.body}
										</p>
									</div>
								))}
								{replyOpen && (
									<form
										className="bg-background rounded-sm p-2 shadow-[0_0_0_1px_var(--border)]"
										onSubmit={handleReply}
									>
										<Textarea
											value={reply}
											onChange={event => setReply(event.target.value)}
											onKeyDown={handleReplyKeyDown}
											aria-keyshortcuts="Meta+Enter Control+Enter"
											placeholder={t("comments.replyPlaceholder")}
											minRows={2}
										/>
										<div className="mt-2 flex justify-end gap-1">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={cancelReply}
											>
												{t("editor.dialog.cancel")}
											</Button>
											<Button type="submit" size="sm" disabled={!reply.trim()}>
												<MessageSquarePlus />
												{t("comments.reply")}
												<Kbd>
													{getActiveShortcutPlatform() === "mac"
														? "⌘↵"
														: "Ctrl+Enter"}
												</Kbd>
											</Button>
										</div>
									</form>
								)}
							</div>
						)}
					</article>
				}
			/>
			<ContextMenuContent>
				<ContextMenuItem onClick={openReply}>
					<MessageSquarePlus />
					{t("comments.reply")}
				</ContextMenuItem>
				{thread.resolvedAt ? (
					<ContextMenuItem onClick={() => reopenCommentThread(thread)}>
						<RotateCcw />
						{t("comments.reopen")}
					</ContextMenuItem>
				) : (
					<ContextMenuItem onClick={() => resolveCommentThread(thread)}>
						<Check />
						{t("comments.resolve")}
					</ContextMenuItem>
				)}
				<ContextMenuItem
					variant="destructive"
					onClick={() => deleteCommentThread(thread)}
				>
					<Trash2 />
					{t("comments.delete")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}

function ThreadActionsMenu({
	thread,
	onReply,
}: {
	thread: ReturnType<typeof getVisibleCommentThreads>[number]
	onReply: () => void
}) {
	let t = useIntl()
	let [menuOpen, setMenuOpen] = useState(false)

	function handleReply() {
		setMenuOpen(false)
		onReply()
	}

	return (
		<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
			<DropdownMenuTrigger
				render={
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={t("comments.moreActions")}
						nativeButton
					>
						<MoreHorizontal />
					</Button>
				}
			/>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={handleReply}>
					<MessageSquarePlus />
					{t("comments.reply")}
				</DropdownMenuItem>
				{thread.resolvedAt ? (
					<DropdownMenuItem onClick={() => reopenCommentThread(thread)}>
						<RotateCcw />
						{t("comments.reopen")}
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem onClick={() => resolveCommentThread(thread)}>
						<Check />
						{t("comments.resolve")}
					</DropdownMenuItem>
				)}
				<DropdownMenuItem
					variant="destructive"
					onClick={() => deleteCommentThread(thread)}
				>
					<Trash2 />
					{t("comments.delete")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
