import { useLocation, useNavigate } from "@tanstack/react-router"
import { Cloud, HardDrive, MoreHorizontal } from "lucide-react"
import { Button } from "./ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { writeStorageMode } from "@/app/lib/storage-mode"

export { StorageModeMenu, StorageModeMenuItems }

function StorageModeMenu() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button size="icon-sm" variant="ghost" aria-label="File options">
						<MoreHorizontal className="size-4" />
					</Button>
				}
			/>
			<DropdownMenuContent align="end">
				<StorageModeMenuItems />
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function StorageModeMenuItems() {
	let location = useLocation()
	let navigate = useNavigate()
	let mode = location.pathname === "/local" ? "filesystem" : "synced"

	function handleModeChange(value: unknown) {
		if (value !== "filesystem" && value !== "synced") return
		if (value === mode) return
		writeStorageMode(value)
		void navigate({ to: value === "filesystem" ? "/local" : "/" })
	}

	return (
		<DropdownMenuGroup>
			<DropdownMenuLabel>Mode</DropdownMenuLabel>
			<DropdownMenuRadioGroup value={mode} onValueChange={handleModeChange}>
				<DropdownMenuRadioItem value="synced">
					<Cloud />
					Synced
				</DropdownMenuRadioItem>
				<DropdownMenuRadioItem value="filesystem">
					<HardDrive />
					Filesystem
				</DropdownMenuRadioItem>
			</DropdownMenuRadioGroup>
		</DropdownMenuGroup>
	)
}
