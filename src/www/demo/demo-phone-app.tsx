import { useEffect, useState } from "react"
import {
	Teleprompter,
	TeleprompterTopBar,
	groupBySlide,
	parsePresentation,
} from "@/app/features/presentation"
import { DemoProviders } from "./demo-providers"
import { DemoEditorPane } from "./demo-editor-pane"
import {
	parseStageMessage,
	phoneMessage,
	type DemoPhoneScreen,
	type PhoneMessage,
} from "./demo-phone-protocol"

export { DemoPhoneApp }

let noWikilinks = new Map()

interface PhoneState {
	locale: "en" | "de"
	screen: DemoPhoneScreen
}

function DemoPhoneApp() {
	let [state, setState] = useState<PhoneState | null>(null)

	useEffect(() => {
		function receive(event: MessageEvent) {
			if (event.origin !== window.location.origin) return
			let message = parseStageMessage(event.data)
			if (message) setState({ locale: message.locale, screen: message.screen })
		}
		window.addEventListener("message", receive)
		tellStage({ type: "ready" })
		return () => window.removeEventListener("message", receive)
	}, [])

	if (!state) return null
	return (
		<DemoProviders key={state.locale} locale={state.locale}>
			<PhoneScreen screen={state.screen} />
		</DemoProviders>
	)
}

function PhoneScreen({ screen }: { screen: DemoPhoneScreen }) {
	if (screen.kind === "editor") {
		return (
			<div className="flex h-svh w-full flex-col">
				<DemoEditorPane
					content={screen.content}
					cursors={screen.cursors}
					comments={[]}
					onType={content => tellStage({ type: "typed", content })}
					onWheel={deltaY => tellStage({ type: "wheel", deltaY })}
				/>
			</div>
		)
	}
	return <PhoneTeleprompter screen={screen} />
}

// The app's teleprompter screen, with the speaker ticking through paragraphs.
function PhoneTeleprompter({
	screen,
}: {
	screen: Extract<DemoPhoneScreen, { kind: "teleprompter" }>
}) {
	let items = parsePresentation(screen.content)
	let slideGroups = groupBySlide(items)
	let slideNumber = items[screen.presentationIndex]?.slideNumber ?? 0
	return (
		<div className="bg-background flex h-svh w-full flex-col">
			<TeleprompterTopBar
				editorLink={<a href="#" onClick={event => event.preventDefault()} />}
				slideshowHref="#"
				wide={false}
				previewVisible={false}
				onTogglePreview={() => {}}
				currentSlideIdx={slideGroups.findIndex(
					group => group.slideNumber === slideNumber,
				)}
				totalSlides={slideGroups.length}
			/>
			<div className="flex min-h-0 flex-1 flex-col">
				<Teleprompter
					items={items}
					wikilinks={noWikilinks}
					presentationIndex={screen.presentationIndex}
					onIndexChange={index => tellStage({ type: "index", index })}
				/>
			</div>
		</div>
	)
}

function tellStage(event: PhoneMessage) {
	window.parent.postMessage(phoneMessage(event), window.location.origin)
}
