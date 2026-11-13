import { replaceShortcutTokens } from "@/app/lib/shortcut-registry"
import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { createDocument, useLibrary } from "@/app/features/documents"
import { fetchWelcomeContent } from "./lib/welcome-content"
export { OnboardingScreen }
let tutors: Record<string, string> = {
	markdown: "/docs/tutor-markdown.md",
	alkalye: "/docs/tutor-alkalye.md",
	presentation: "/docs/tutor-presentations.md",
}
function OnboardingScreen({ slug }: { slug?: string }) {
	let { db, ownerId, documents, isLoading } = useLibrary()
	let navigate = useNavigate()
	let creating = useRef(false)
	useEffect(() => {
		if (isLoading || creating.current) return
		creating.current = true
		async function open() {
			let url = slug ? tutors[slug] : "/docs/welcome.md"
			if (!url) {
				void navigate({ to: "/", replace: true })
				return
			}
			let content = slug
				? await fetch(url).then(response => {
						if (!response.ok) throw new Error("Tutor unavailable")
						return response.text().then(replaceShortcutTokens)
					})
				: await fetchWelcomeContent()
			let existing = documents.find(
				doc => !doc.deletedAt && doc.content === content,
			)
			let doc = existing ?? (await createDocument(db, ownerId, content))
			await navigate({ to: "/doc/$id", params: { id: doc.id }, replace: true })
		}
		void open().catch(console.error)
	}, [db, ownerId, documents, isLoading, navigate, slug])
	return <p role="status">Opening document…</p>
}
