import type { ReactElement } from "react"
import {
	PanelRightClose,
	PanelRightOpen,
	Presentation,
	Scan,
} from "lucide-react"
import { Button } from "@/app/components/ui/button"
import { T, useIntl } from "@/shared/intl/setup"

export { TeleprompterTopBar }

function TeleprompterTopBar({
	editorLink,
	slideshowHref,
	wide,
	previewVisible,
	onTogglePreview,
	currentSlideIdx,
	totalSlides,
}: {
	editorLink: ReactElement
	slideshowHref: string
	wide: boolean
	previewVisible: boolean
	onTogglePreview: () => void
	currentSlideIdx: number
	totalSlides: number
}) {
	let t = useIntl()
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
				render={editorLink}
			>
				<T k="presentation.teleprompter.editor" />
			</Button>
			<span className="text-muted-foreground text-sm">
				{t("presentation.teleprompter.slideIndicator", {
					index: String(currentSlideIdx + 1),
					total: String(totalSlides),
				})}
			</span>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					aria-label={t(
						previewVisible
							? "presentation.laser.hide"
							: "presentation.laser.show",
					)}
					aria-pressed={wide ? previewVisible : undefined}
					aria-haspopup={wide ? undefined : "dialog"}
					aria-expanded={wide ? undefined : previewVisible}
					onClick={onTogglePreview}
				>
					<Scan className="md:hidden" />
					<span className="hidden md:inline-flex">
						{previewVisible ? <PanelRightClose /> : <PanelRightOpen />}
					</span>
					<span className="md:hidden">
						{t(
							previewVisible
								? "presentation.laser.notes"
								: "presentation.laser.open",
						)}
					</span>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					nativeButton={false}
					render={
						<a href={slideshowHref} target="_blank" rel="noopener noreferrer" />
					}
				>
					<Presentation className="md:hidden" />
					<span className="sr-only md:not-sr-only">
						<T k="presentation.teleprompter.slideshow" />
					</span>
				</Button>
			</div>
		</div>
	)
}
