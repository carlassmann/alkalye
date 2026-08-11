import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/app/lib/cn"
import { Button } from "@/app/components/ui/button"
import { XIcon } from "lucide-react"

export {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetOverlay,
	SheetPortal,
	SheetTitle,
	SheetTrigger,
}

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			data-slot="sheet-overlay"
			className={cn(
				"data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 fixed inset-0 isolate z-50 bg-black/10 duration-200 supports-backdrop-filter:backdrop-blur-xs",
				className,
			)}
			{...props}
		/>
	)
}

type SheetSide = "top" | "right" | "bottom" | "left"

interface SheetContentProps extends DialogPrimitive.Popup.Props {
	side?: SheetSide
	showCloseButton?: boolean
	closeLabel?: string
}

function SheetContent({
	className,
	children,
	side = "right",
	showCloseButton = true,
	closeLabel = "Close",
	...props
}: SheetContentProps) {
	let sideStyles = {
		top: "inset-x-0 top-0 data-open:animate-in data-closed:animate-out data-closed:slide-out-to-top data-open:slide-in-from-top",
		right:
			"inset-y-0 right-0 h-full w-3/4 max-w-sm data-open:animate-in data-closed:animate-out data-closed:slide-out-to-right data-open:slide-in-from-right",
		bottom:
			"inset-x-0 bottom-0 data-open:animate-in data-closed:animate-out data-closed:slide-out-to-bottom data-open:slide-in-from-bottom",
		left: "inset-y-0 left-0 h-full w-3/4 max-w-sm data-open:animate-in data-closed:animate-out data-closed:slide-out-to-left data-open:slide-in-from-left",
	}

	return (
		<SheetPortal>
			<SheetOverlay />
			<DialogPrimitive.Popup
				data-slot="sheet-content"
				className={cn(
					"bg-background ring-foreground/10 fixed z-50 flex flex-col gap-4 p-4 ring-1 duration-200 outline-none",
					sideStyles[side],
					className,
				)}
				style={{
					paddingTop: "max(1rem, env(safe-area-inset-top))",
					paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
					paddingRight:
						side === "right" ? "max(1rem, env(safe-area-inset-right))" : "1rem",
					paddingLeft:
						side === "left" ? "max(1rem, env(safe-area-inset-left))" : "1rem",
				}}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close
						data-slot="sheet-close"
						render={
							<Button
								variant="ghost"
								className="absolute top-2 right-2"
								size="icon-sm"
								style={{
									top: "max(0.5rem, env(safe-area-inset-top))",
								}}
							/>
						}
					>
						<XIcon />
						<span className="sr-only">{closeLabel}</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Popup>
		</SheetPortal>
	)
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-header"
			className={cn("flex flex-col gap-1 text-left", className)}
			{...props}
		/>
	)
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="sheet-title"
			className={cn("text-sm font-medium", className)}
			{...props}
		/>
	)
}

function SheetDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="sheet-description"
			className={cn("text-muted-foreground text-xs", className)}
			{...props}
		/>
	)
}
