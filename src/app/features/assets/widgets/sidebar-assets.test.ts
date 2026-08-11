import React, { type MouseEventHandler, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

interface MockProps {
	children?: ReactNode
	disabled?: boolean
	onClick?: MouseEventHandler<HTMLButtonElement>
	render?: ReactNode
}

function Container({ children }: MockProps) {
	return React.createElement("div", null, children)
}

function Button({ children, disabled, onClick }: MockProps) {
	return React.createElement("button", { disabled, onClick }, children)
}

function RenderProp({ render }: MockProps) {
	return render
}

vi.mock("@/app/components/ui/sidebar", () => ({
	SidebarGroupLabel: Container,
	SidebarGroupContent: Container,
	SidebarMenu: Container,
	SidebarMenuButton: Button,
	SidebarMenuItem: Container,
	useSidebar: () => ({ isMobile: false }),
}))

vi.mock("@/app/components/ui/dropdown-menu", () => ({
	DropdownMenu: Container,
	DropdownMenuContent: Container,
	DropdownMenuItem: Button,
	DropdownMenuTrigger: RenderProp,
}))

vi.mock("@/app/components/ui/tooltip", () => ({
	Tooltip: Container,
	TooltipContent: Container,
	TooltipTrigger: RenderProp,
}))

vi.mock("@/shared/intl/setup", () => ({
	T: () => null,
	useIntl: () => (key: string) => key,
}))

vi.mock("@/app/components/appearance", () => ({
	useResolvedTheme: () => "light",
}))

afterEach(() => {
	document.body.replaceChildren()
})

describe("SidebarAssets", () => {
	it("does not pass the menu click event to the whiteboard callback", async () => {
		let onCreateTldraw = vi.fn()
		let container = document.createElement("div")
		document.body.append(container)
		let root = createRoot(container)
		let { SidebarAssets } = await import("./sidebar-assets")

		flushSync(() => {
			root.render(
				React.createElement(SidebarAssets, {
					assets: [],
					onCreateTldraw,
				}),
			)
		})

		let button = Array.from(container.querySelectorAll("button")).find(
			candidate => candidate.textContent === "assets.newWhiteboard",
		)
		expect(button).toBeDefined()

		flushSync(() => {
			button?.click()
		})

		expect(onCreateTldraw).toHaveBeenCalledOnce()
		expect(onCreateTldraw).toHaveBeenCalledWith()
		flushSync(() => root.unmount())
	})
})
