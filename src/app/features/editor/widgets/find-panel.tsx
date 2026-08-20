import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { EditorView } from "@codemirror/view"
import { X, ChevronUp, ChevronDown, CaseSensitive } from "lucide-react"
import { cn } from "@/app/lib/cn"
import { Button } from "@/app/components/ui/button"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import { Kbd } from "@/app/components/ui/kbd"
import { getShortcutLabel } from "@/app/lib/shortcut-registry"
import { useSidebar } from "@/app/components/ui/sidebar"
import {
	getFindState,
	replaceAllMatches,
	replaceCurrentMatch,
	selectMatch,
	setFindQuery,
} from "../lib/find-extension"
import { useIntl, T } from "@/shared/intl/setup"

export { FindPanel }

interface FindPanelProps {
	view: EditorView | null
	query?: string
	caseSensitive?: boolean
	fuzzy?: boolean
	replaceOpen?: boolean
	onQueryChange?: (query: string) => void
	onCaseChange?: (caseSensitive: boolean) => void
	onFuzzyChange?: (fuzzy: boolean) => void
	onClose: () => void
	onHeightChange?: (height: number) => void
}

function FindPanel({
	view,
	query: controlledQuery,
	caseSensitive: controlledCaseSensitive,
	fuzzy: controlledFuzzy,
	replaceOpen,
	onQueryChange,
	onCaseChange,
	onFuzzyChange,
	onClose,
	onHeightChange,
}: FindPanelProps) {
	let t = useIntl()
	let { rightOpen, isMobile } = useSidebar()
	let inputRef = useRef<HTMLInputElement>(null)
	let panelRef = useRef<HTMLDivElement>(null)
	let [selectionScope] = useState(() =>
		view && view.state.selection.main.from !== view.state.selection.main.to
			? {
					from: view.state.selection.main.from,
					to: view.state.selection.main.to,
				}
			: undefined,
	)

	// Use controlled values or local state with persistence
	let isControlled = controlledQuery !== undefined
	let [localQuery, setLocalQuery] = useState(controlledQuery ?? lastQuery)
	let [localCaseSensitive, setLocalCaseSensitive] = useState(
		controlledCaseSensitive ?? lastCaseSensitive,
	)
	let [localFuzzy, setLocalFuzzy] = useState(controlledFuzzy ?? lastFuzzy)

	let query = isControlled ? (controlledQuery ?? "") : localQuery
	let caseSensitive = isControlled
		? (controlledCaseSensitive ?? false)
		: localCaseSensitive
	let fuzzy = isControlled ? (controlledFuzzy ?? false) : localFuzzy

	let [matchInfo, setMatchInfo] = useState({ current: 0, total: 0 })
	let [replacement, setReplacement] = useState(lastReplacement)
	let [selectionOnly, setSelectionOnly] = useState(false)

	let closeRef = useRef(onClose)
	let viewRef = useRef(view)

	// Keep refs in sync on every render to avoid stale closures in event handlers
	useEffect(() => {
		closeRef.current = onClose
		viewRef.current = view
	})

	// Focus input on mount
	useEffect(() => {
		inputRef.current?.focus()
		inputRef.current?.select()
	}, [])

	// Report height changes
	useEffect(() => {
		if (!panelRef.current || !onHeightChange) return

		let observer = new ResizeObserver(entries => {
			let entry = entries[0]
			if (entry) {
				onHeightChange(entry.contentRect.height + 16) // +16 for padding
			}
		})

		observer.observe(panelRef.current)
		onHeightChange(panelRef.current.offsetHeight + 16)

		return () => observer.disconnect()
	}, [onHeightChange])

	// Global Escape handler
	useEffect(() => {
		function handleGlobalKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				e.preventDefault()
				if (viewRef.current) {
					setFindQuery(viewRef.current, "", false, false)
					viewRef.current.focus()
				}
				closeRef.current()
			}
		}

		document.addEventListener("keydown", handleGlobalKeyDown)
		return () => document.removeEventListener("keydown", handleGlobalKeyDown)
	}, [])

	// Sync query to editor
	useEffect(() => {
		if (!view) return

		setFindQuery(view, query, caseSensitive, fuzzy)

		// Persist for next open
		lastQuery = query
		lastCaseSensitive = caseSensitive
		lastFuzzy = fuzzy

		// Update match info after state settles
		requestAnimationFrame(() => {
			let state = getFindState(view)
			setMatchInfo({
				current: state.currentIndex + 1,
				total: state.matches.length,
			})
		})
	}, [view, query, caseSensitive, fuzzy])

	// Poll for match info changes (when navigating matches)
	useEffect(() => {
		if (!view) return

		let lastCurrent = -1
		let lastTotal = -1

		let interval = setInterval(() => {
			let state = getFindState(view)
			let current = state.currentIndex + 1
			let total = state.matches.length

			if (current !== lastCurrent || total !== lastTotal) {
				lastCurrent = current
				lastTotal = total
				setMatchInfo({ current, total })
			}
		}, 100)

		return () => clearInterval(interval)
	}, [view])

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Escape") return
		if (e.key === "Enter") {
			e.preventDefault()
			if (view) {
				selectMatch(view, e.shiftKey ? "prev" : "next")
				if (e.metaKey || e.ctrlKey) {
					view.focus()
				}
			}
		}
	}

	function handleClose() {
		if (view) {
			// Clear highlights
			setFindQuery(view, "", false, false)
			view.focus()
		}
		onClose()
	}

	function handleNext() {
		if (view) selectMatch(view, "next")
	}

	function handlePrev() {
		if (view) selectMatch(view, "prev")
	}

	function handleReplace() {
		if (!view) return
		if (
			replaceCurrentMatch(
				view,
				replacement,
				selectionOnly ? selectionScope : undefined,
			)
		) {
			lastReplacement = replacement
		}
	}

	function handleReplaceAll() {
		if (!view) return
		replaceAllMatches(
			view,
			replacement,
			selectionOnly ? selectionScope : undefined,
		)
		lastReplacement = replacement
	}

	let sidebarWidth = rightOpen && !isMobile ? "14rem" : "0px"

	let panel = (
		<div
			ref={panelRef}
			className={cn(
				"find-panel bg-background border-border fixed z-50 flex flex-col gap-1.5 rounded border p-2 shadow-md transition-[right] duration-200 ease-in md:py-1.5",
				!replaceOpen && "md:flex-row md:items-center",
			)}
			style={{
				top: "calc(48px + env(safe-area-inset-top) + 0.75rem)",
				right: `calc(${sidebarWidth} + 0.75rem)`,
				left: isMobile ? "0.75rem" : "auto",
			}}
		>
			{/* Row 1: Input + Close */}
			<div className="flex items-center gap-1.5">
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={e => {
						if (isControlled) {
							onQueryChange?.(e.target.value)
						} else {
							setLocalQuery(e.target.value)
						}
					}}
					onKeyDown={handleKeyDown}
					placeholder={t("editor.find.placeholder")}
					className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-7 flex-1 rounded-none border bg-transparent px-2 text-xs outline-none focus-visible:ring-1 md:w-48 md:flex-none"
				/>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button size="icon-xs" variant="ghost" onClick={handleClose}>
								<span className="sr-only">{t("editor.find.close")}</span>
								<X className="size-3.5" />
							</Button>
						}
					/>
					<TooltipContent side="bottom">
						<T k="editor.find.close" /> <Kbd>Esc</Kbd>
					</TooltipContent>
				</Tooltip>
			</div>

			{replaceOpen && (
				<div className="flex flex-wrap items-center gap-1.5">
					<input
						value={replacement}
						onChange={event => setReplacement(event.target.value)}
						onKeyDown={event => {
							if (event.key === "Enter") {
								event.preventDefault()
								handleReplace()
							}
						}}
						placeholder="Replace with…"
						aria-label="Replace with"
						className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-7 min-w-40 flex-1 border bg-transparent px-2 text-xs outline-none focus-visible:ring-1"
					/>
					<Button size="xs" variant="outline" onClick={handleReplace}>
						Replace
					</Button>
					<Button size="xs" variant="outline" onClick={handleReplaceAll}>
						Replace all
					</Button>
					<label className="flex min-h-7 items-center gap-1.5 px-1 text-xs">
						<input
							type="checkbox"
							checked={selectionOnly}
							disabled={!selectionScope}
							onChange={event => setSelectionOnly(event.target.checked)}
						/>
						Selection only
					</label>
				</div>
			)}

			{/* Row 2: Controls */}
			<div className="flex items-center gap-1.5">
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								size="icon-xs"
								variant={caseSensitive ? "secondary" : "ghost"}
								aria-label={t("editor.find.caseSensitive")}
								aria-pressed={caseSensitive}
								onClick={() => {
									if (isControlled) {
										onCaseChange?.(!caseSensitive)
									} else {
										setLocalCaseSensitive(!caseSensitive)
									}
								}}
							>
								<CaseSensitive className="size-3.5" />
							</Button>
						}
					/>
					<TooltipContent side="bottom">
						<T k="editor.find.caseSensitive" />
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								size="xs"
								variant={fuzzy ? "secondary" : "ghost"}
								aria-label={t("editor.find.fuzzyMatching")}
								aria-pressed={fuzzy}
								onClick={() => {
									if (isControlled) {
										onFuzzyChange?.(!fuzzy)
									} else {
										setLocalFuzzy(!fuzzy)
									}
								}}
								className="px-1.5 font-mono"
							>
								.*
							</Button>
						}
					/>
					<TooltipContent side="bottom">
						<T k="editor.find.fuzzyMatching" />
					</TooltipContent>
				</Tooltip>

				<span
					className={cn(
						"text-muted-foreground flex-1 text-center text-xs tabular-nums md:min-w-[4rem] md:flex-none",
						matchInfo.total === 0 && query && "text-destructive",
					)}
				>
					{query
						? matchInfo.total > 0
							? t("editor.find.matchCount", {
									current: String(matchInfo.current),
									total: String(matchInfo.total),
								})
							: t("editor.find.noResults")
						: ""}
				</span>

				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								size="icon-xs"
								variant="ghost"
								onClick={handlePrev}
								disabled={matchInfo.total === 0}
								aria-label={t("editor.find.previous")}
							>
								<ChevronUp className="size-3.5" />
							</Button>
						}
					/>
					<TooltipContent side="bottom">
						<T k="editor.find.previous" /> <Kbd>Shift</Kbd>
						<Kbd>{getShortcutLabel("findPrevious")}</Kbd>{" "}
						{t("editor.find.shortcutOr")} <Kbd>Shift+Enter</Kbd>
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								size="icon-xs"
								variant="ghost"
								onClick={handleNext}
								disabled={matchInfo.total === 0}
								aria-label={t("editor.find.next")}
							>
								<ChevronDown className="size-3.5" />
							</Button>
						}
					/>
					<TooltipContent side="bottom">
						<p>
							<T k="editor.find.next" />{" "}
							<Kbd>{getShortcutLabel("findNext")}</Kbd>{" "}
							{t("editor.find.shortcutOr")} <Kbd>Enter</Kbd>
						</p>
						<p>
							<T k="editor.find.goToMatch" />{" "}
							<Kbd>{getShortcutLabel("goToFindMatch")}</Kbd>
						</p>
					</TooltipContent>
				</Tooltip>
			</div>
		</div>
	)

	return createPortal(panel, document.body)
}

// Module-level state for persistence across panel open/close
let lastQuery = ""
let lastCaseSensitive = false
let lastFuzzy = false
let lastReplacement = ""
