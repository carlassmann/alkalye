import { useEffect, useRef, useState } from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import {
	X,
	EllipsisVertical,
	ChevronLeft,
	ChevronRight,
	ChevronDown,
} from "lucide-react"
import { Button } from "@/app/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
} from "@/app/components/ui/dropdown-menu"
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import { Kbd } from "@/app/components/ui/kbd"
import { cn } from "@/app/lib/cn"
import { useIntl } from "@/shared/intl/setup"
import {
	formatEditDate,
	groupEditsByDay,
	type DayGroup,
	type EditHistoryItem,
} from "../lib/time-machine"

export { TimeMachineToolbar, TimeMachineBottomBar }
export type { ViewMode }

type ViewMode = "days" | "edits"

interface TimeMachineToolbarProps {
	editDate: Date
	authorName: string
	onExit: () => void
	onCreateCopy: () => void
	onRestore: () => void
}

function TimeMachineToolbar({
	editDate,
	authorName,
	onExit,
	onCreateCopy,
	onRestore,
}: TimeMachineToolbarProps) {
	let t = useIntl()

	return (
		<div
			className="border-border bg-background fixed top-0 right-0 left-0 z-20 flex items-center justify-between border-b px-4 py-2"
			style={{
				paddingTop: "max(0.5rem, env(safe-area-inset-top))",
				paddingLeft: "max(1rem, env(safe-area-inset-left))",
				paddingRight: "max(1rem, env(safe-area-inset-right))",
			}}
		>
			<Button
				variant="ghost"
				size="sm"
				onClick={onExit}
				aria-label={t("timeMachine.exit")}
				className="gap-1.5"
			>
				<X className="size-4" />
				<span className="hidden sm:inline">{t("timeMachine.exit")}</span>
			</Button>

			<div className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center">
				<span className="text-foreground text-sm font-medium">
					{t("timeMachine.title")}
				</span>
				<span className="text-muted-foreground text-xs">
					{t("timeMachine.dateByAuthor", {
						date: formatEditDate(editDate),
						author: authorName,
					})}
				</span>
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							nativeButton={false}
							aria-label={t("timeMachine.actions")}
						>
							<EllipsisVertical className="size-4" />
						</Button>
					}
				/>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={onCreateCopy}>
						{t("timeMachine.createCopy")}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onRestore}>
						{t("timeMachine.restoreThisVersion")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}

interface TimeMachineBottomBarProps {
	editHistory: EditHistoryItem[]
	onEditChange: (
		editIndex: number,
		options: { mode: ViewMode; replace: boolean },
	) => void
	editParam?: number
	mode?: ViewMode
}

let HOLD_DELAY_MS = 1500

function TimeMachineBottomBar({
	editHistory,
	onEditChange,
	editParam,
	mode,
}: TimeMachineBottomBarProps) {
	let t = useIntl()

	let debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	let holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
	let holdDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	let holdEditRef = useRef(0)
	let [holdingDirection, setHoldingDirection] = useState<
		"prev" | "next" | null
	>(null)

	let totalEdits = editHistory.length
	let dayGroups = groupEditsByDay(editHistory)

	let currentEditIndex =
		editParam !== undefined
			? Math.min(Math.max(0, editParam), totalEdits - 1)
			: totalEdits - 1

	let viewMode: ViewMode = mode ?? "days"
	let selectedDayIndex: number | null = null
	if (viewMode === "edits") {
		selectedDayIndex = dayGroups.findIndex(day =>
			day.edits.some(e => e.index === currentEditIndex),
		)
		if (selectedDayIndex === -1) selectedDayIndex = null
	}

	let hasHistory = totalEdits > 0
	let disabled = dayGroups.length <= 1 && totalEdits <= 1
	let isViewingDay = viewMode === "edits" && selectedDayIndex !== null
	let selectedDay =
		selectedDayIndex !== null ? dayGroups[selectedDayIndex] : null

	let sliderMax: number
	let sliderValue: number

	if (isViewingDay && selectedDay) {
		sliderMax = selectedDay.edits.length - 1
		let editIndexInDay = selectedDay.edits.findIndex(
			e => e.index === currentEditIndex,
		)
		sliderValue = editIndexInDay >= 0 ? editIndexInDay : 0
	} else {
		sliderMax = totalEdits - 1
		sliderValue = currentEditIndex
	}

	useEffect(() => {
		holdEditRef.current = currentEditIndex
	}, [currentEditIndex])

	function sliderToEditIndex(value: number): number {
		if (isViewingDay && selectedDay) {
			return selectedDay.edits[value]?.index ?? currentEditIndex
		}
		return value
	}

	function navigateToEdit(editIndex: number, replace = false) {
		onEditChange(editIndex, { mode: viewMode, replace })
	}

	function handleSliderChange(value: number) {
		if (debounceRef.current) clearTimeout(debounceRef.current)
		debounceRef.current = setTimeout(() => {
			let editIndex = sliderToEditIndex(value)
			navigateToEdit(editIndex, true)
		}, 150)
	}

	function handleSliderCommit(value: number) {
		if (debounceRef.current) {
			clearTimeout(debounceRef.current)
			debounceRef.current = null
		}
		navigateToEdit(sliderToEditIndex(value))
	}

	function handleViewModeChange(newMode: ViewMode, dayIndex?: number) {
		let targetEdit = currentEditIndex
		if (newMode === "edits" && dayIndex !== undefined) {
			let day = dayGroups[dayIndex]
			if (day && day.edits.length > 0) {
				targetEdit = day.edits[day.edits.length - 1].index
			}
		}
		onEditChange(targetEdit, { mode: newMode, replace: true })
	}

	function getTooltipContent(value: number): string | undefined {
		let edit: EditHistoryItem | undefined
		if (isViewingDay && selectedDay) {
			edit = selectedDay.edits[value]
		} else {
			edit = editHistory[value]
		}
		if (!edit) return undefined
		return isViewingDay
			? edit.madeAt.toLocaleTimeString(undefined, {
					hour: "numeric",
					minute: "2-digit",
				})
			: formatEditDate(edit.madeAt)
	}

	function getPreviousEditIndex(fromIndex: number): number | null {
		if (isViewingDay && selectedDay) {
			let editIndexInDay = selectedDay.edits.findIndex(
				e => e.index === fromIndex,
			)
			if (editIndexInDay > 0) return selectedDay.edits[editIndexInDay - 1].index
		} else {
			if (fromIndex > 0) return fromIndex - 1
		}
		return null
	}

	function getNextEditIndex(fromIndex: number): number | null {
		if (isViewingDay && selectedDay) {
			let editIndexInDay = selectedDay.edits.findIndex(
				e => e.index === fromIndex,
			)
			if (editIndexInDay < selectedDay.edits.length - 1)
				return selectedDay.edits[editIndexInDay + 1].index
		} else {
			if (fromIndex < totalEdits - 1) return fromIndex + 1
		}
		return null
	}

	function startHold(direction: "prev" | "next") {
		stopHold()
		holdEditRef.current = currentEditIndex
		let getNext =
			direction === "prev"
				? () => getPreviousEditIndex(holdEditRef.current)
				: () => getNextEditIndex(holdEditRef.current)

		let idx = getNext()
		if (idx !== null) {
			holdEditRef.current = idx
			navigateToEdit(idx)
		}

		setHoldingDirection(direction)
		holdDelayRef.current = setTimeout(() => {
			setHoldingDirection(null)
			holdIntervalRef.current = setInterval(() => {
				let nextIdx = getNext()
				if (nextIdx !== null) {
					holdEditRef.current = nextIdx
					navigateToEdit(nextIdx)
				} else {
					stopHold()
				}
			}, 100)
		}, HOLD_DELAY_MS)
	}

	function stopHold() {
		setHoldingDirection(null)
		if (holdDelayRef.current) {
			clearTimeout(holdDelayRef.current)
			holdDelayRef.current = null
		}
		if (holdIntervalRef.current) {
			clearInterval(holdIntervalRef.current)
			holdIntervalRef.current = null
		}
	}

	let isAtStart =
		isViewingDay && selectedDay
			? selectedDay.edits[0]?.index === currentEditIndex
			: currentEditIndex === 0

	let isAtEnd =
		isViewingDay && selectedDay
			? selectedDay.edits[selectedDay.edits.length - 1]?.index ===
				currentEditIndex
			: currentEditIndex >= totalEdits - 1

	let statusText: string
	if (!hasHistory) {
		statusText = t("timeMachine.noPreviousVersions")
	} else if (isViewingDay && selectedDay) {
		let editIndexInDay =
			selectedDay.edits.findIndex(e => e.index === currentEditIndex) + 1
		statusText = `${editIndexInDay}/${selectedDay.edits.length}`
	} else {
		statusText = `${currentEditIndex + 1}/${totalEdits}`
	}

	let dropdownLabel = isViewingDay
		? formatDayLabel(selectedDay!.date)
		: t("timeMachine.allHistory")

	return (
		<div
			className="border-border bg-background fixed right-0 bottom-0 left-0 flex flex-col gap-3 border-t px-4 py-3 md:flex-row md:items-center md:gap-4"
			style={{
				paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
				paddingLeft: "max(1rem, env(safe-area-inset-left))",
				paddingRight: "max(1rem, env(safe-area-inset-right))",
			}}
		>
			<div className="flex items-center gap-3 md:hidden">
				<TimeMachineSlider
					min={0}
					max={Math.max(0, sliderMax)}
					value={sliderValue}
					onChange={handleSliderChange}
					onCommit={handleSliderCommit}
					disabled={disabled || !hasHistory || sliderMax === 0}
					className="flex-1"
					getTooltipContent={getTooltipContent}
				/>
			</div>

			<div className="flex items-center justify-between gap-3 md:hidden">
				<div className="flex items-center gap-2">
					<HoldButton
						direction="prev"
						holdingDirection={holdingDirection}
						onStartHold={startHold}
						onStopHold={stopHold}
						disabled={disabled || isAtStart || !hasHistory}
					/>
					<HoldButton
						direction="next"
						holdingDirection={holdingDirection}
						onStartHold={startHold}
						onStopHold={stopHold}
						disabled={disabled || isAtEnd || !hasHistory}
					/>
				</div>
				<DateDropdown
					dayGroups={dayGroups}
					selectedDayIndex={selectedDayIndex}
					dropdownLabel={dropdownLabel}
					disabled={disabled}
					hasHistory={hasHistory}
					onViewModeChange={handleViewModeChange}
				/>
				<div className="text-muted-foreground shrink-0 text-sm tabular-nums">
					{statusText}
				</div>
			</div>

			<TooltipProvider>
				<div className="hidden items-center gap-2 md:flex">
					<Tooltip>
						<TooltipTrigger
							render={
								<HoldButton
									direction="prev"
									holdingDirection={holdingDirection}
									onStartHold={startHold}
									onStopHold={stopHold}
									disabled={disabled || isAtStart || !hasHistory}
									showLabel
									nativeButton={false}
								/>
							}
						/>
						<TooltipContent side="top">
							{t("timeMachine.previousEdit")} <Kbd>[</Kbd>
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger
							render={
								<HoldButton
									direction="next"
									holdingDirection={holdingDirection}
									onStartHold={startHold}
									onStopHold={stopHold}
									disabled={disabled || isAtEnd || !hasHistory}
									showLabel
									nativeButton={false}
								/>
							}
						/>
						<TooltipContent side="top">
							{t("timeMachine.nextEdit")} <Kbd>]</Kbd>
						</TooltipContent>
					</Tooltip>
				</div>
			</TooltipProvider>

			<DateDropdown
				dayGroups={dayGroups}
				selectedDayIndex={selectedDayIndex}
				dropdownLabel={dropdownLabel}
				disabled={disabled}
				hasHistory={hasHistory}
				onViewModeChange={handleViewModeChange}
				className="hidden md:flex"
			/>

			<div className="hidden flex-1 items-center gap-4 md:flex">
				<TimeMachineSlider
					min={0}
					max={Math.max(0, sliderMax)}
					value={sliderValue}
					onChange={handleSliderChange}
					onCommit={handleSliderCommit}
					disabled={disabled || !hasHistory || sliderMax === 0}
					className="flex-1"
					getTooltipContent={getTooltipContent}
				/>
			</div>

			<div className="text-muted-foreground hidden shrink-0 text-sm tabular-nums md:block">
				{statusText}
			</div>
		</div>
	)
}

interface HoldButtonProps {
	direction: "prev" | "next"
	holdingDirection: "prev" | "next" | null
	onStartHold: (direction: "prev" | "next") => void
	onStopHold: () => void
	disabled: boolean
	showLabel?: boolean
	nativeButton?: boolean
}

function HoldButton({
	direction,
	holdingDirection,
	onStartHold,
	onStopHold,
	disabled,
	showLabel,
	nativeButton,
}: HoldButtonProps) {
	let t = useIntl()
	let isHolding = holdingDirection === direction
	let Icon = direction === "prev" ? ChevronLeft : ChevronRight
	let label =
		direction === "prev" ? t("timeMachine.previous") : t("timeMachine.next")
	let ariaLabel =
		direction === "prev"
			? t("timeMachine.previousEdit")
			: t("timeMachine.nextEdit")

	return (
		<Button
			variant="outline"
			size="sm"
			onMouseDown={() => onStartHold(direction)}
			onMouseUp={onStopHold}
			onMouseLeave={onStopHold}
			onTouchStart={() => onStartHold(direction)}
			onTouchEnd={onStopHold}
			disabled={disabled}
			aria-label={ariaLabel}
			nativeButton={nativeButton}
			className="relative gap-1 overflow-hidden"
		>
			{isHolding && (
				<span
					className="bg-primary/20 absolute inset-0 origin-left"
					style={{
						animation: `hold-progress ${HOLD_DELAY_MS}ms linear forwards`,
					}}
				/>
			)}
			{direction === "prev" && <Icon className="relative size-4" />}
			{showLabel ? (
				<span className="relative">{label}</span>
			) : (
				<span className="sr-only sm:not-sr-only">{label}</span>
			)}
			{direction === "next" && <Icon className="relative size-4" />}
		</Button>
	)
}

function formatDayLabel(date: Date): string {
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year:
			date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
	})
}

function formatMonthLabel(date: Date): string {
	return date.toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
	})
}

type MonthGroup = {
	label: string
	days: { day: DayGroup; originalIndex: number }[]
	totalEdits: number
}

function groupDaysByMonth(dayGroups: DayGroup[]): {
	recentDays: { day: DayGroup; originalIndex: number }[]
	olderMonths: MonthGroup[]
} {
	let now = new Date()
	let sevenDaysAgo = new Date(now)
	sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
	sevenDaysAgo.setHours(0, 0, 0, 0)

	let recentDays: { day: DayGroup; originalIndex: number }[] = []
	let olderDays: { day: DayGroup; originalIndex: number }[] = []

	dayGroups.forEach((day, idx) => {
		if (day.date >= sevenDaysAgo) {
			recentDays.push({ day, originalIndex: idx })
		} else {
			olderDays.push({ day, originalIndex: idx })
		}
	})

	let monthMap = new Map<string, MonthGroup>()
	for (let item of olderDays) {
		let monthKey = `${item.day.date.getFullYear()}-${item.day.date.getMonth()}`
		let existing = monthMap.get(monthKey)
		if (existing) {
			existing.days.push(item)
			existing.totalEdits += item.day.edits.length
		} else {
			monthMap.set(monthKey, {
				label: formatMonthLabel(item.day.date),
				days: [item],
				totalEdits: item.day.edits.length,
			})
		}
	}

	let olderMonths = Array.from(monthMap.values())

	return { recentDays, olderMonths }
}

interface DateDropdownProps {
	dayGroups: DayGroup[]
	selectedDayIndex: number | null
	dropdownLabel: string
	disabled: boolean
	hasHistory: boolean
	onViewModeChange: (mode: ViewMode, dayIndex?: number) => void
	className?: string
}

function DateDropdown({
	dayGroups,
	selectedDayIndex,
	dropdownLabel,
	disabled,
	hasHistory,
	onViewModeChange,
	className = "",
}: DateDropdownProps) {
	let t = useIntl()
	let totalEdits = dayGroups.reduce((sum, day) => sum + day.edits.length, 0)
	let { recentDays, olderMonths } = groupDaysByMonth(dayGroups)

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={disabled || !hasHistory}
				className={`border-input bg-background hover:bg-muted hover:text-foreground h-9 items-center justify-between gap-1 rounded-none border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 md:h-7 md:px-2.5 md:text-xs ${className || "flex"}`}
			>
				<span>{dropdownLabel}</span>
				<ChevronDown className="size-4 opacity-50" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				side="top"
				align="start"
				className="max-h-80 overflow-y-auto"
			>
				<DropdownMenuRadioGroup
					value={selectedDayIndex !== null ? String(selectedDayIndex) : "all"}
					onValueChange={value => {
						if (value === "all") {
							onViewModeChange("days")
						} else {
							onViewModeChange("edits", Number(value))
						}
					}}
				>
					<DropdownMenuRadioItem value="all">
						{t("timeMachine.allHistoryCount", { count: String(totalEdits) })}
					</DropdownMenuRadioItem>

					{recentDays.length > 0 && (
						<>
							<DropdownMenuSeparator />
							{recentDays.map(({ day, originalIndex }) => (
								<DropdownMenuRadioItem
									key={originalIndex}
									value={String(originalIndex)}
								>
									{formatDayLabel(day.date)} ({day.edits.length})
								</DropdownMenuRadioItem>
							))}
						</>
					)}
				</DropdownMenuRadioGroup>

				{olderMonths.length > 0 && (
					<>
						<DropdownMenuSeparator />
						{olderMonths.map(month => (
							<DropdownMenuSub key={month.label}>
								<DropdownMenuSubTrigger>
									{month.label} ({month.totalEdits})
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent>
									<DropdownMenuRadioGroup
										value={
											selectedDayIndex !== null
												? String(selectedDayIndex)
												: "all"
										}
										onValueChange={value => {
											if (value !== "all") {
												onViewModeChange("edits", Number(value))
											}
										}}
									>
										{month.days.map(({ day, originalIndex }) => (
											<DropdownMenuRadioItem
												key={originalIndex}
												value={String(originalIndex)}
											>
												{formatDayLabel(day.date)} ({day.edits.length})
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						))}
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

interface TimeMachineSliderProps {
	min: number
	max: number
	value: number
	onChange: (value: number) => void
	onCommit: (value: number) => void
	disabled?: boolean
	className?: string
	getTooltipContent: (value: number) => string | undefined
}

function TimeMachineSlider({
	min,
	max,
	value,
	onChange,
	onCommit,
	disabled,
	className,
	getTooltipContent,
}: TimeMachineSliderProps) {
	let t = useIntl()
	let [localValue, setLocalValue] = useState(value)
	let [isHovering, setIsHovering] = useState(false)
	let [isDragging, setIsDragging] = useState(false)

	function handleValueChange(newValue: number, details: { reason: string }) {
		setLocalValue(newValue)
		if (details.reason === "drag") {
			setIsDragging(true)
		}
		onChange(newValue)
	}

	function handleValueCommitted(committedValue: number) {
		setIsDragging(false)
		setLocalValue(committedValue)
		onCommit(committedValue)
	}

	let displayValue = isDragging ? localValue : value
	let tooltipContent = getTooltipContent(displayValue)
	let showTooltip = (isDragging || isHovering) && tooltipContent

	return (
		<SliderPrimitive.Root
			className={cn("data-horizontal:w-full", className)}
			value={displayValue}
			onValueChange={handleValueChange}
			onValueCommitted={handleValueCommitted}
			min={min}
			max={max}
			disabled={disabled}
			thumbAlignment="edge"
		>
			<SliderPrimitive.Control className="relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-50">
				<SliderPrimitive.Track className="bg-muted relative h-1.5 w-full rounded-none select-none">
					<SliderPrimitive.Indicator className="bg-primary h-full select-none" />
					<SliderPrimitive.Thumb
						getAriaLabel={() => t("timeMachine.editHistory")}
						getAriaValueText={(_, thumbValue) =>
							getTooltipContent(thumbValue) ?? String(thumbValue)
						}
						className="border-ring ring-ring/50 relative block size-5 shrink-0 rounded-none border bg-white transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-1 focus-visible:ring-1 focus-visible:outline-hidden active:ring-1 disabled:pointer-events-none disabled:opacity-50"
						onMouseEnter={() => setIsHovering(true)}
						onMouseLeave={() => setIsHovering(false)}
					>
						{showTooltip && (
							<div className="bg-foreground text-background absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-none px-2 py-1 text-xs whitespace-nowrap">
								{tooltipContent}
								<div className="bg-foreground absolute top-full left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45" />
							</div>
						)}
					</SliderPrimitive.Thumb>
				</SliderPrimitive.Track>
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	)
}
