import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cn } from "@/app/lib/cn"
import { useIsMobile } from "@/app/hooks/use-mobile"
import { Button } from "@/app/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/app/components/ui/sheet"
import {
	PanelRight,
	PanelLeft,
	PanelRightClose,
	PanelLeftClose,
} from "lucide-react"

export type { SidebarSide }
export {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarSeparator,
	SidebarTrigger,
	useSidebar,
}

type SidebarSide = "left" | "right"

function useSidebar() {
	let context = React.useContext(SidebarContext)
	if (!context) {
		throw new Error("useSidebar must be used within a SidebarProvider.")
	}
	return context
}

interface SidebarProviderProps extends React.ComponentProps<"div"> {
	defaultLeftOpen?: boolean
	defaultRightOpen?: boolean
}

function SidebarProvider({
	defaultLeftOpen = false,
	defaultRightOpen = false,
	className,
	style,
	children,
	...props
}: SidebarProviderProps) {
	let isMobile = useIsMobile()
	let [leftOpenMobile, _setLeftOpenMobile] = React.useState(false)
	let [rightOpenMobile, _setRightOpenMobile] = React.useState(false)
	let leftMobileCompleteRef = React.useRef<(() => void) | null>(null)
	let rightMobileCompleteRef = React.useRef<(() => void) | null>(null)

	let [leftOpen, _setLeftOpen] = React.useState(() =>
		getStoredState(STORAGE_KEY_LEFT, defaultLeftOpen),
	)
	let [rightOpen, _setRightOpen] = React.useState(() =>
		getStoredState(STORAGE_KEY_RIGHT, defaultRightOpen),
	)

	function setLeftOpenMobile(open: boolean, onComplete?: () => void) {
		if (onComplete && !open) {
			if (!leftOpenMobile) {
				onComplete()
			} else {
				leftMobileCompleteRef.current = onComplete
			}
		}
		_setLeftOpenMobile(open)
	}

	function setRightOpenMobile(open: boolean, onComplete?: () => void) {
		if (onComplete && !open) {
			if (!rightOpenMobile) {
				onComplete()
			} else {
				rightMobileCompleteRef.current = onComplete
			}
		}
		_setRightOpenMobile(open)
	}

	function setLeftOpen(value: boolean) {
		_setLeftOpen(value)
		localStorage.setItem(STORAGE_KEY_LEFT, String(value))
	}

	function setRightOpen(value: boolean) {
		_setRightOpen(value)
		localStorage.setItem(STORAGE_KEY_RIGHT, String(value))
	}

	function toggleLeft() {
		if (isMobile) {
			setLeftOpenMobile(!leftOpenMobile)
		} else {
			setLeftOpen(!leftOpen)
		}
	}

	function toggleRight() {
		if (isMobile) {
			setRightOpenMobile(!rightOpenMobile)
		} else {
			setRightOpen(!rightOpen)
		}
	}

	function fireLeftMobileComplete() {
		let cb = leftMobileCompleteRef.current
		leftMobileCompleteRef.current = null
		cb?.()
	}

	function fireRightMobileComplete() {
		let cb = rightMobileCompleteRef.current
		rightMobileCompleteRef.current = null
		cb?.()
	}

	let contextValue: SidebarContextValue = {
		leftOpen,
		setLeftOpen,
		leftOpenMobile,
		setLeftOpenMobile,
		rightOpen,
		setRightOpen,
		rightOpenMobile,
		setRightOpenMobile,
		fireLeftMobileComplete,
		fireRightMobileComplete,
		isMobile,
		toggleLeft,
		toggleRight,
	}

	return (
		<SidebarContext.Provider value={contextValue}>
			<div
				data-slot="sidebar-wrapper"
				data-left-sidebar-open={leftOpen && !isMobile}
				data-right-sidebar-open={rightOpen && !isMobile}
				style={
					{
						"--left-sidebar-width": SIDEBAR_WIDTH,
						"--right-sidebar-width": SIDEBAR_WIDTH,
						"--sidebar-width-mobile": SIDEBAR_WIDTH_MOBILE,
						...style,
					} as React.CSSProperties
				}
				className={cn("group/sidebar-wrapper flex h-full w-full", className)}
				{...props}
			>
				{children}
			</div>
		</SidebarContext.Provider>
	)
}

interface SidebarProps extends React.ComponentProps<"div"> {
	side?: "left" | "right"
	collapsible?: "offcanvas" | "icon" | "none"
	mobileTitle?: string
	mobileCloseLabel?: string
}

function Sidebar({
	side = "right",
	collapsible = "offcanvas",
	className,
	children,
	mobileTitle,
	mobileCloseLabel,
	...props
}: SidebarProps) {
	let ctx = useSidebar()
	let isMobile = ctx.isMobile
	let open = side === "left" ? ctx.leftOpen : ctx.rightOpen
	let openMobile = side === "left" ? ctx.leftOpenMobile : ctx.rightOpenMobile
	let setOpenMobile =
		side === "left" ? ctx.setLeftOpenMobile : ctx.setRightOpenMobile
	let fireComplete =
		side === "left" ? ctx.fireLeftMobileComplete : ctx.fireRightMobileComplete
	let state: "expanded" | "collapsed" = open ? "expanded" : "collapsed"

	function handleOpenChange(open: boolean) {
		setOpenMobile(open)
	}

	function handleOpenChangeComplete(open: boolean) {
		if (open) return // only fire on close
		fireComplete()
	}

	if (collapsible === "none") {
		return (
			<div
				data-slot="sidebar"
				className={cn(
					"bg-background text-foreground flex h-full flex-col border-l",
					side === "left"
						? "w-(--left-sidebar-width)"
						: "w-(--right-sidebar-width)",
					className,
				)}
				{...props}
			>
				{children}
			</div>
		)
	}

	if (isMobile) {
		return (
			<Sheet
				open={openMobile}
				onOpenChange={handleOpenChange}
				onOpenChangeComplete={handleOpenChangeComplete}
			>
				<SheetContent
					side={side}
					closeLabel={mobileCloseLabel}
					className="bg-background text-foreground w-(--sidebar-width-mobile)"
					style={
						{
							"--sidebar-width-mobile": SIDEBAR_WIDTH_MOBILE,
							paddingTop: "env(safe-area-inset-top)",
							paddingBottom: "env(safe-area-inset-bottom)",
							paddingLeft: side === "left" ? "env(safe-area-inset-left)" : 0,
							paddingRight: side === "right" ? "env(safe-area-inset-right)" : 0,
						} as React.CSSProperties
					}
				>
					{mobileTitle && (
						<SheetTitle className="sr-only">{mobileTitle}</SheetTitle>
					)}
					<div className="flex h-full w-full flex-col">{children}</div>
				</SheetContent>
			</Sheet>
		)
	}

	return (
		<div
			data-slot="sidebar"
			data-state={state}
			data-side={side}
			className="group peer hidden lg:block"
		>
			<div
				className={cn(
					"bg-background fixed inset-y-0 z-10 hidden h-full transition-[left,right,width] duration-200 ease-in lg:flex",
					side === "left"
						? "left-0 w-(--left-sidebar-width) group-data-[state=collapsed]:left-[calc(var(--left-sidebar-width)*-1)]"
						: "right-0 w-(--right-sidebar-width) group-data-[state=collapsed]:right-[calc(var(--right-sidebar-width)*-1)]",
					className,
				)}
				style={{
					paddingTop: "env(safe-area-inset-top)",
					paddingBottom: "env(safe-area-inset-bottom)",
					paddingLeft:
						side === "left" ? "env(safe-area-inset-left)" : undefined,
					paddingRight:
						side === "right" ? "env(safe-area-inset-right)" : undefined,
				}}
				{...props}
			>
				<div
					data-slot="sidebar-container"
					className={cn(
						"bg-background text-foreground flex h-full w-full flex-col",
						side === "left" ? "border-r" : "border-l",
					)}
				>
					{children}
				</div>
			</div>
		</div>
	)
}

function SidebarTrigger({
	side = "right",
	className,
	onClick,
	...props
}: { side?: SidebarSide } & React.ComponentProps<typeof Button>) {
	let { toggleLeft, toggleRight, leftOpen, rightOpen } = useSidebar()
	let toggle = side === "left" ? toggleLeft : toggleRight
	let isOpen = side === "left" ? leftOpen : rightOpen
	let Icon =
		side === "left"
			? isOpen
				? PanelLeftClose
				: PanelLeft
			: isOpen
				? PanelRightClose
				: PanelRight

	return (
		<Button
			data-slot="sidebar-trigger"
			variant="ghost"
			size="icon"
			className={cn("size-11 pointer-fine:size-7", className)}
			onClick={event => {
				onClick?.(event)
				toggle()
			}}
			{...props}
		>
			<Icon />
			<span className="sr-only">Toggle Sidebar</span>
		</Button>
	)
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
	return (
		<main
			data-slot="sidebar-inset"
			className={cn(
				"bg-background relative flex h-full flex-1 flex-col",
				className,
			)}
			{...props}
		/>
	)
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-header"
			className={cn("flex flex-col gap-2 p-2", className)}
			{...props}
		/>
	)
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-footer"
			className={cn("flex flex-col gap-2 p-2", className)}
			{...props}
		/>
	)
}

function SidebarSeparator({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-separator"
			className={cn("bg-sidebar-border mx-2 h-px", className)}
			{...props}
		/>
	)
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-content"
			className={cn(
				"flex min-h-0 flex-1 flex-col gap-2 overflow-auto",
				className,
			)}
			{...props}
		/>
	)
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-group"
			className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
			{...props}
		/>
	)
}

function SidebarGroupLabel({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-group-label"
			className={cn(
				"text-sidebar-foreground/70 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-none px-2 text-xs font-medium outline-none [&>svg]:size-4 [&>svg]:shrink-0",
				className,
			)}
			{...props}
		/>
	)
}

function SidebarGroupAction({
	className,
	...props
}: React.ComponentProps<"button">) {
	return (
		<button
			data-slot="sidebar-group-action"
			className={cn(
				"text-sidebar-foreground ring-sidebar-ring pointer-fine:hover:bg-sidebar-accent pointer-fine:hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-8 items-center justify-center rounded-none p-0 transition-transform outline-none focus-visible:ring-2 pointer-fine:w-5 [&>svg]:size-4 [&>svg]:shrink-0",
				"after:absolute after:-inset-2 after:pointer-fine:hidden",
				className,
			)}
			{...props}
		/>
	)
}

function SidebarGroupContent({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-group-content"
			className={cn("w-full text-sm", className)}
			{...props}
		/>
	)
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="sidebar-menu"
			className={cn("flex w-full min-w-0 flex-col gap-1", className)}
			{...props}
		/>
	)
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="sidebar-menu-item"
			className={cn("group/menu-item relative list-none", className)}
			{...props}
		/>
	)
}

type SidebarMenuButtonProps = ButtonPrimitive.Props & {
	isActive?: boolean
	size?: "default" | "sm" | "lg"
}

function SidebarMenuButton({
	isActive = false,
	size = "default",
	className,
	nativeButton = false,
	...props
}: SidebarMenuButtonProps) {
	return (
		<ButtonPrimitive
			data-slot="sidebar-menu-button"
			data-active={isActive}
			nativeButton={nativeButton}
			className={cn(
				"peer/menu-button ring-sidebar-ring pointer-fine:hover:bg-sidebar-accent pointer-fine:hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-[active=true]:bg-foreground data-[active=true]:text-background flex w-full items-center gap-2 overflow-hidden rounded-none p-2 text-left text-sm transition-[width,height] outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:font-medium [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
				size === "sm" && "h-9 text-xs pointer-fine:h-7",
				size === "lg" && "h-12 text-sm",
				className,
			)}
			{...props}
		/>
	)
}

function SidebarMenuAction({
	className,
	...props
}: React.ComponentProps<"button">) {
	return (
		<button
			data-slot="sidebar-menu-action"
			className={cn(
				"text-sidebar-foreground ring-sidebar-ring pointer-fine:hover:bg-sidebar-accent pointer-fine:hover:text-sidebar-accent-foreground pointer-fine:peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 flex aspect-square w-8 items-center justify-center rounded-none p-0 transition-transform outline-none focus-visible:ring-2 pointer-fine:w-5 [&>svg]:size-4 [&>svg]:shrink-0",
				"after:absolute after:-inset-2 after:pointer-fine:hidden",
				className,
			)}
			{...props}
		/>
	)
}

// Non-exported helpers below

let SIDEBAR_WIDTH = "14rem"
let SIDEBAR_WIDTH_MOBILE = "18rem"

let STORAGE_KEY_LEFT = "sidebar-left-open"
let STORAGE_KEY_RIGHT = "sidebar-right-open"

type SidebarContextValue = {
	leftOpen: boolean
	setLeftOpen: (open: boolean) => void
	leftOpenMobile: boolean
	setLeftOpenMobile: (open: boolean, onComplete?: () => void) => void
	rightOpen: boolean
	setRightOpen: (open: boolean) => void
	rightOpenMobile: boolean
	setRightOpenMobile: (open: boolean, onComplete?: () => void) => void
	fireLeftMobileComplete: () => void
	fireRightMobileComplete: () => void
	isMobile: boolean
	toggleLeft: () => void
	toggleRight: () => void
}

let SidebarContext = React.createContext<SidebarContextValue | null>(null)

function getStoredState(key: string, defaultValue: boolean): boolean {
	if (typeof window === "undefined") return defaultValue
	let stored = localStorage.getItem(key)
	if (stored === null) return defaultValue
	return stored === "true"
}
