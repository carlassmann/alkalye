import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import type { MarkdownEditorRef } from "./editor"
import { Button } from "@/app/components/ui/button"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import { Separator } from "@/app/components/ui/separator"
import {
	Bold,
	Italic,
	Code,
	Heading,
	List,
	ListTodo,
	Link2,
	EyeOff,
	Eye,
	Copy,
	Check,
	ListIcon,
	Wrench,
	ArrowUpToLine,
	ArrowDownToLine,
} from "lucide-react"
import { Kbd } from "@/app/components/ui/kbd"
import { getShortcutLabel, type ShortcutId } from "@/app/lib/shortcut-registry"
import { ThemePicker, PresetPicker } from "@/app/features/themes"
import { cn } from "@/app/lib/cn"
import { useIntl, T } from "@/shared/intl/setup"

export { EditorToolbar }

interface EditorToolbarProps {
	editor: React.RefObject<MarkdownEditorRef | null>
	readOnly?: boolean
	onToggleLeftSidebar: () => void
	onToggleRightSidebar: () => void
	docId?: string

	onSaveCopy?: () => Promise<void>
	saveCopyState?: "idle" | "saving" | "saved"
	content?: string
	onThemeChange?: (newContent: string) => void
}

function EditorToolbar({
	editor,
	readOnly,
	onToggleLeftSidebar,
	onToggleRightSidebar,
	docId,

	onSaveCopy,
	saveCopyState = "idle",
	content,
	onThemeChange,
}: EditorToolbarProps) {
	let t = useIntl()
	let isAtTop = useEditorScrollTopState(editor)

	function scrollToTop() {
		let view = editor.current?.getEditor()
		if (!view) return
		view.scrollDOM.scrollTop = 0
	}

	function scrollToBottom() {
		let view = editor.current?.getEditor()
		if (!view) return
		let maxTop = Math.max(
			0,
			view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight,
		)
		view.scrollDOM.scrollTop = maxTop
	}

	return (
		<div
			className="editor-toolbar bg-background border-border fixed top-0 right-0 left-0 z-10 flex items-center border-b"
			style={{
				paddingTop:
					"calc(env(safe-area-inset-top) + var(--screen-keyboard-top-offset, 0px))",
				paddingLeft: "env(safe-area-inset-left)",
				paddingRight: "env(safe-area-inset-right)",
			}}
		>
			<div className="border-border flex shrink-0 items-center gap-1 border-r p-2 md:border-r-0">
				<ToolbarButton
					icon={<ListIcon />}
					label={t("editor.toolbar.documents")}
					shortcutId="leftSidebar"
					onClick={onToggleLeftSidebar}
				/>
			</div>

			<div className="flex flex-1 items-center justify-center gap-1 overflow-x-auto p-2">
				{readOnly ? (
					<>
						<div className="text-muted-foreground flex shrink-0 items-center gap-1.5 px-2 text-sm">
							<EyeOff className="size-4" />
							<T k="editor.toolbar.readOnly" />
						</div>
						{onSaveCopy && (
							<>
								<Separator
									orientation="vertical"
									className="mx-1 h-6 shrink-0"
								/>
								<Button
									variant="outline"
									size="sm"
									onClick={onSaveCopy}
									disabled={saveCopyState !== "idle"}
									className="shrink-0"
									nativeButton
								>
									{saveCopyState === "saved" ? (
										<>
											<Check className="mr-1 size-4" />
											<T k="editor.toolbar.cloned" />
										</>
									) : (
										<>
											<Copy className="mr-1 size-4" />
											{saveCopyState === "saving" ? (
												<T k="editor.toolbar.cloning" />
											) : (
												<T k="editor.toolbar.clone" />
											)}
										</>
									)}
								</Button>
							</>
						)}
					</>
				) : (
					<>
						<ToolbarButton
							icon={<Bold />}
							label={t("editor.toolbar.bold")}
							shortcutId="bold"
							onClick={() => editor.current?.toggleBold()}
						/>
						<ToolbarButton
							icon={<Italic />}
							label={t("editor.toolbar.italic")}
							shortcutId="italic"
							onClick={() => editor.current?.toggleItalic()}
						/>
						<span className="hidden md:contents">
							<ToolbarButton
								icon={<Code />}
								label={t("editor.toolbar.code")}
								shortcutId="inlineCode"
								onClick={() => editor.current?.toggleInlineCode()}
							/>
							<DropdownMenu>
								<Tooltip>
									<DropdownMenuTrigger
										render={
											<TooltipTrigger
												render={
													<Button
														variant="ghost"
														size="icon"
														aria-label={t("editor.toolbar.heading")}
														className="shrink-0"
														nativeButton
													>
														<Heading />
													</Button>
												}
											/>
										}
									/>
									<TooltipContent className="flex items-center gap-2">
										<T k="editor.toolbar.heading" />
										<Kbd>{getShortcutLabel("heading1")}</Kbd>
									</TooltipContent>
								</Tooltip>
								<DropdownMenuContent align="center">
									{([1, 2, 3] as const).map(level => (
										<DropdownMenuItem
											key={level}
											onClick={() => editor.current?.setHeading(level)}
										>
											H{level}
											<span className="text-muted-foreground ml-auto text-xs">
												{getShortcutLabel(`heading${level}`)}
											</span>
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						</span>

						<ToolbarButton
							icon={<List />}
							label={t("editor.toolbar.bulletList")}
							shortcutId="bulletList"
							onClick={() => editor.current?.toggleBulletList()}
						/>
						<span className="hidden md:contents">
							<ToolbarButton
								icon={<ListTodo />}
								label={t("editor.toolbar.taskList")}
								shortcutId="taskList"
								onClick={() => editor.current?.toggleTaskList()}
							/>
							<ToolbarButton
								icon={<Link2 />}
								label={t("editor.toolbar.link")}
								shortcutId="link"
								onClick={() => editor.current?.insertLink()}
							/>
							{content !== undefined && onThemeChange && (
								<>
									<ThemePicker
										content={content}
										onThemeChange={onThemeChange}
										disabled={readOnly}
									/>
									<PresetPicker
										content={content}
										onPresetChange={onThemeChange}
										disabled={readOnly}
									/>
								</>
							)}
						</span>
					</>
				)}
				<ToolbarButton
					icon={<ArrowUpToLine />}
					label={t("editor.toolbar.scrollToTop")}
					onClick={scrollToTop}
					className={isAtTop ? "hidden" : "hidden pointer-coarse:inline-flex"}
				/>
				<ToolbarButton
					icon={<ArrowDownToLine />}
					label={t("editor.toolbar.scrollToBottom")}
					onClick={scrollToBottom}
					className={isAtTop ? "hidden pointer-coarse:inline-flex" : "hidden"}
				/>
				{docId && (
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon"
									aria-label={t("editor.toolbar.preview")}
									className="shrink-0"
									nativeButton={false}
									render={
										<Link
											to="/doc/$id/preview"
											params={{ id: docId }}
											search={{ from: "list" }}
										/>
									}
								>
									<Eye />
								</Button>
							}
						/>
						<TooltipContent className="flex items-center gap-2">
							<T k="editor.toolbar.preview" />
							<Kbd>{getShortcutLabel("preview")}</Kbd>
						</TooltipContent>
					</Tooltip>
				)}
			</div>

			<div className="border-border flex shrink-0 items-center gap-1 border-l p-2 md:border-l-0">
				<ToolbarButton
					icon={<Wrench />}
					label={t("editor.toolbar.documentTools")}
					shortcutId="rightSidebar"
					onClick={onToggleRightSidebar}
				/>
			</div>
		</div>
	)
}

function useEditorScrollTopState(
	editor: React.RefObject<MarkdownEditorRef | null>,
) {
	let [isAtTop, setIsAtTop] = useState(true)

	useEffect(() => {
		let canceled = false
		let frame = 0
		let cleanup = () => {}

		function attachScrollObserver() {
			if (canceled) return
			let view = editor.current?.getEditor()
			if (!view) {
				frame = requestAnimationFrame(attachScrollObserver)
				return
			}

			let scrollEl = view.scrollDOM

			function updateScrollState() {
				setIsAtTop(scrollEl.scrollTop <= 1)
			}

			updateScrollState()
			scrollEl.addEventListener("scroll", updateScrollState, { passive: true })
			window.addEventListener("resize", updateScrollState)

			let observer = new ResizeObserver(updateScrollState)
			observer.observe(scrollEl)

			cleanup = () => {
				scrollEl.removeEventListener("scroll", updateScrollState)
				window.removeEventListener("resize", updateScrollState)
				observer.disconnect()
			}
		}

		attachScrollObserver()

		return () => {
			canceled = true
			cancelAnimationFrame(frame)
			cleanup()
		}
	}, [editor])

	return isAtTop
}

interface ToolbarButtonProps {
	icon: React.ReactNode
	label: string
	shortcutId?: ShortcutId
	onClick: () => void
	className?: string
}

function ToolbarButton({
	icon,
	label,
	shortcutId,
	onClick,
	className,
}: ToolbarButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						onClick={onClick}
						aria-label={label}
						className={cn("shrink-0", className)}
					>
						{icon}
					</Button>
				}
			/>
			<TooltipContent className="flex items-center gap-2">
				{label}
				{shortcutId && <Kbd>{getShortcutLabel(shortcutId)}</Kbd>}
			</TooltipContent>
		</Tooltip>
	)
}
