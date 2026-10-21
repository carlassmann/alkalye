import { useDeferredValue, type ReactNode } from "react"

export { DeferredDocumentEditor }

function DeferredDocumentEditor({ children }: { children: ReactNode }) {
	return useDeferredValue(children)
}
