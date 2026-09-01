import { Bird } from "lucide-react"
import { T } from "@/shared/intl/setup"

export { Footer }

function Footer() {
	return (
		<footer className="text-muted-foreground mx-auto max-w-2xl px-3 py-6 text-center text-xs">
			<div className="flex items-center justify-center gap-4">
				<a
					href="https://twitter.com/carlassmann"
					target="_blank"
					rel="noopener noreferrer"
					className="hover:text-foreground p-1 transition-colors"
				>
					<Bird className="size-4" />
					<span className="sr-only">@carlassmann</span>
				</a>
				<a
					href="https://github.com/carlassmann/alkalye"
					target="_blank"
					rel="noopener noreferrer"
					className="hover:text-foreground p-1 transition-colors"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
						<path d="M9 18c-4.51 2-5-2-7-2" />
					</svg>
					<span className="sr-only">GitHub</span>
				</a>
				<a
					href="/privacy"
					className="hover:text-foreground p-1 transition-colors"
				>
					<T k="footer.privacy" />
				</a>
				<a
					href="/imprint"
					className="hover:text-foreground p-1 transition-colors"
				>
					<T k="footer.imprint" />
				</a>
			</div>
		</footer>
	)
}
