import { FolderInput } from "lucide-react"
import { Button } from "@/app/components/ui/button"
export { SidebarImportExport }
function SidebarImportExport() {
	// v2-todo(import-export): import/export library.
	return (
		<Button variant="ghost" size="icon" disabled aria-label="Import and export">
			<FolderInput />
		</Button>
	)
}
