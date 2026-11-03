import { useEffect } from "react"
import { loadSyntwin } from "./syntwin-script"

export { SyntwinLauncher, SyntwinGuide, syntwinEnabled }

let roomId =
	import.meta.env.PUBLIC_SYNTWIN_ROOM_ID ?? "j974c6r0d9xj7d19cmfzzt9qw98hg52b"
let syntwinEnabled = Boolean(
	import.meta.env.PUBLIC_SYNTWIN_ENABLED !== "false" && roomId,
)

function SyntwinLauncher({ locale }: { locale: string }) {
	return (
		<>
			<SyntwinGuide locale={locale} surface="website" />
			{syntwinEnabled && (
				<button
					type="button"
					data-syntwin-open
					className="border-border hover:bg-muted focus-visible:ring-ring inline-flex min-h-12 cursor-pointer items-center justify-center border px-6 text-sm font-medium focus-visible:ring-2"
				>
					{locale === "de" ? "Frag Carls KI-Twin" : "Ask Carl’s AI twin"}
				</button>
			)}
		</>
	)
}

function SyntwinGuide({
	locale,
	surface = "app",
}: {
	locale: string
	surface?: "website" | "app"
}) {
	useEffect(() => {
		document.documentElement.lang = locale
		if (!syntwinEnabled || !roomId) return
		loadSyntwin(document, roomId, surface)
	}, [locale, surface])
	return null
}
