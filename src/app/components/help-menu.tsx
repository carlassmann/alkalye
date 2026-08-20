import { Link } from "@tanstack/react-router"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	DropdownMenuLabel,
	DropdownMenuGroup,
} from "@/app/components/ui/dropdown-menu"
import { ExternalLink, Keyboard } from "lucide-react"
import { T } from "@/shared/intl/setup"

export { HelpMenu }

interface HelpMenuProps {
	trigger: React.ReactElement
	align?: "start" | "center" | "end"
	side?: "top" | "bottom" | "left" | "right"
	onNavigate?: () => void
}

function HelpMenu({
	trigger,
	align = "start",
	side = "bottom",
	onNavigate,
}: HelpMenuProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={trigger} />
			<DropdownMenuContent align={align} side={side}>
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						<T k="help.label" />
					</DropdownMenuLabel>
					<DropdownMenuItem
						render={<Link to="/welcome" onClick={onNavigate} />}
					>
						<T k="help.welcome" />
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() =>
							document.dispatchEvent(new Event("alkalye:open-shortcuts"))
						}
					>
						<Keyboard />
						<T k="help.shortcuts" />
					</DropdownMenuItem>
					<DropdownMenuItem
						render={
							<Link
								to="/tutor/$slug"
								params={{ slug: "alkalye" }}
								onClick={onNavigate}
							/>
						}
					>
						<T k="help.tutorAlkalye" />
					</DropdownMenuItem>
					<DropdownMenuItem
						render={
							<Link
								to="/tutor/$slug"
								params={{ slug: "markdown" }}
								onClick={onNavigate}
							/>
						}
					>
						<T k="help.tutorMarkdown" />
					</DropdownMenuItem>
					<DropdownMenuItem
						render={
							<Link
								to="/tutor/$slug"
								params={{ slug: "presentation" }}
								onClick={onNavigate}
							/>
						}
					>
						<T k="help.tutorPresentation" />
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						<T k="help.linksLabel" />
					</DropdownMenuLabel>
					<DropdownMenuItem
						render={
							<a
								href="https://github.com/ccssmnn/alkalye"
								target="_blank"
								rel="noopener noreferrer"
							/>
						}
					>
						<T k="help.github" />
						<ExternalLink className="ml-auto size-3 opacity-50" />
					</DropdownMenuItem>
					<DropdownMenuItem
						render={
							<a
								href="https://twitter.com/ccssmnn"
								target="_blank"
								rel="noopener noreferrer"
							/>
						}
					>
						<T k="help.twitter" />
						<ExternalLink className="ml-auto size-3 opacity-50" />
					</DropdownMenuItem>
					<DropdownMenuItem
						render={<a href="/" target="_blank" rel="noopener noreferrer" />}
					>
						<T k="help.website" />
						<ExternalLink className="ml-auto size-3 opacity-50" />
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
