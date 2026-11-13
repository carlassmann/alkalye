import { useDocumentAssets } from "@/app/features/assets"
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
import { useLibrary } from "../lib/library"
import { Preview } from "../widgets/preview"
import { DocumentNotFound } from "@/app/components/error-states"
export { DocPreviewScreen }
function DocPreviewScreen({ id }: { id: string }) {
	let { documents } = useLibrary()
	let doc = documents.find(doc => doc.id === id && !doc.deletedAt)
	let { previewAssets } = useDocumentAssets(id, doc?.content ?? "")
	let navigate = useNavigate()
	if (!doc) return <DocumentNotFound />
	let wikilinks = new Map(
		documents.map(doc => [
			doc.id,
			{ id: doc.id, title: doc.title, exists: !doc.deletedAt },
		]),
	)
	return (
		<div className="bg-background fixed inset-0 flex flex-col">
			<TopBar
				id={id}
				docTitle={doc.title}
				commentsEnabled
				commentsOpen={false}
				unresolvedCommentCount={0}
				onToggleComments={() => {
					/* v2-todo(comments) */
				}}
			/>
			<div className="relative flex min-h-0 flex-1">
				<title>{doc.title}</title>
				<Preview
					content={doc.content}
					localAssets={previewAssets}
					wikilinks={wikilinks}
					onExit={() => void navigate({ to: "/doc/$id", params: { id } })}
				/>
			</div>
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
						disabled
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
