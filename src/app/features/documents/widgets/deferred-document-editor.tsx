import {
	createContext,
	useContext,
	useDeferredValue,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react"
import type { LoaderDocument } from "../lib/queries"

export { DeferredDocumentEditor, useCurrentDocumentGetter }

let CurrentDocument = createContext<(() => LoaderDocument) | null>(null)

function DeferredDocumentEditor({
	document,
	children,
}: {
	document: LoaderDocument
	children: ReactNode
}) {
	let current = useRef(document)
	useLayoutEffect(() => {
		current.current = document
	}, [document])
	// A stable getter keeps Jazz snapshots out of urgent context updates.
	let [getCurrentDocument] = useState(() => () => current.current)
	let deferredChildren = useDeferredValue(children)
	return (
		<CurrentDocument value={getCurrentDocument}>
			{deferredChildren}
		</CurrentDocument>
	)
}

function useCurrentDocumentGetter() {
	let getCurrentDocument = useContext(CurrentDocument)
	if (!getCurrentDocument)
		throw new Error("Document editor provider is missing")
	return getCurrentDocument
}
