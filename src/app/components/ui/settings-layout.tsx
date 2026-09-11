import type { ReactNode } from "react"
import { cn } from "@/app/lib/cn"

export {
	SettingsSection,
	SettingsPanel,
	SettingsRow,
	SettingsBlock,
	SettingsGroupLabel,
	SettingsStatus,
	SettingsActions,
	SettingsEmpty,
	SettingsHint,
}

interface SettingsSectionProps {
	title: ReactNode
	description?: ReactNode
	action?: ReactNode
	children: ReactNode
}

function SettingsSection({
	title,
	description,
	action,
	children,
}: SettingsSectionProps) {
	return (
		<section className="space-y-3">
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
				<div className="min-w-0">
					<h2 className="text-foreground text-sm font-semibold">{title}</h2>
					{description && (
						<p className="text-muted-foreground mt-1 max-w-[60ch] text-base/6 text-pretty sm:text-sm/5">
							{description}
						</p>
					)}
				</div>
				{action && <div className="flex shrink-0 items-center">{action}</div>}
			</div>
			{children}
		</section>
	)
}

/** Flat, square surface that stacks its children as divider-separated rows. */
function SettingsPanel({
	className,
	children,
}: {
	className?: string
	children: ReactNode
}) {
	return (
		<div
			className={cn(
				"border-border bg-muted/20 divide-border divide-y border",
				className,
			)}
		>
			{children}
		</div>
	)
}

interface SettingsRowProps {
	label: ReactNode
	description?: ReactNode
	htmlFor?: string
	labelId?: string
	className?: string
	children: ReactNode
}

function SettingsRow({
	label,
	description,
	htmlFor,
	labelId,
	className,
	children,
}: SettingsRowProps) {
	return (
		<div
			className={cn(
				"grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5",
				className,
			)}
		>
			<div className="min-w-0">
				{htmlFor ? (
					<label
						id={labelId}
						htmlFor={htmlFor}
						className="text-base sm:text-sm"
					>
						{label}
					</label>
				) : (
					<div id={labelId} className="text-base sm:text-sm">
						{label}
					</div>
				)}
				{description && (
					<p className="text-muted-foreground mt-0.5 text-sm text-pretty sm:text-xs">
						{description}
					</p>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-2">{children}</div>
		</div>
	)
}

/** Row whose content needs the full width instead of a label/control split. */
function SettingsBlock({
	className,
	children,
}: {
	className?: string
	children: ReactNode
}) {
	return <div className={cn("px-4 py-3", className)}>{children}</div>
}

function SettingsGroupLabel({ children }: { children: ReactNode }) {
	return (
		<div className="text-muted-foreground px-4 pt-3 pb-1 text-xs font-medium">
			{children}
		</div>
	)
}

interface SettingsStatusProps {
	tone?: "ok" | "muted" | "error"
	icon?: ReactNode
	description?: ReactNode
	action?: ReactNode
	children: ReactNode
}

function SettingsStatus({
	tone = "muted",
	icon,
	description,
	action,
	children,
}: SettingsStatusProps) {
	return (
		<div className="px-4 py-3">
			<div className="flex items-center gap-2">
				<div
					className={cn(
						"flex min-w-0 flex-1 items-center gap-2 text-base/6 font-medium sm:text-sm/5",
						tone === "ok" && "text-brand",
						tone === "muted" && "text-muted-foreground",
						tone === "error" && "text-destructive",
					)}
				>
					{icon}
					<span className="min-w-0">{children}</span>
				</div>
				{action}
			</div>
			{description && (
				<div className="text-muted-foreground mt-1 max-w-[70ch] text-base/6 text-pretty sm:text-sm/5">
					{description}
				</div>
			)}
		</div>
	)
}

function SettingsActions({ children }: { children: ReactNode }) {
	return <div className="flex flex-wrap gap-2 px-4 py-3">{children}</div>
}

function SettingsHint({ children }: { children: ReactNode }) {
	return (
		<p className="text-muted-foreground px-4 pb-3 text-sm text-pretty sm:text-xs">
			{children}
		</p>
	)
}

interface SettingsEmptyProps {
	icon?: ReactNode
	title: ReactNode
	description?: ReactNode
}

function SettingsEmpty({ icon, title, description }: SettingsEmptyProps) {
	return (
		<div className="text-muted-foreground px-4 py-8 text-center">
			{icon && (
				<div className="mb-2 flex justify-center opacity-50">{icon}</div>
			)}
			<p className="text-base/6 sm:text-sm/5">{title}</p>
			{description && (
				<p className="mt-1 text-sm text-pretty opacity-80 sm:text-xs">
					{description}
				</p>
			)}
		</div>
	)
}
