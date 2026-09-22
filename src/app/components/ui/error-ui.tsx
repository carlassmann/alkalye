import { IconTransition } from "@/app/components/ui/icon-transition"
import { useState } from "react"
import type { ReactNode } from "react"
import { AlertTriangle, Copy, Check } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card"
import { useIntl } from "@/shared/intl/setup"

export { ErrorUI }

type ErrorUIProps = {
	error?: Error
	componentStack?: string
	title: ReactNode
	description: ReactNode
	actions?: ReactNode
}

function ErrorUI({
	error,
	componentStack,
	title,
	description,
	actions,
}: ErrorUIProps) {
	let t = useIntl()
	let [copied, setCopied] = useState(false)

	function handleCopyError() {
		if (!error) return

		let errorText = `Error Message:\n${error.message}\n\nStack Trace:\n${error.stack || "No stack trace available"}`

		if (componentStack) {
			errorText += `\n\nComponent Stack:\n${componentStack}`
		}

		navigator.clipboard.writeText(errorText).then(
			() => {
				setCopied(true)
				setTimeout(() => setCopied(false), 2000)
			},
			() => {},
		)
	}

	return (
		<main className="container mx-auto max-w-6xl px-3 py-6 pb-20 md:pt-20 md:pb-0">
			<Card className="mx-auto max-w-lg">
				<CardHeader>
					<CardTitle className="flex items-center gap-3">
						<AlertTriangle className="text-destructive size-5" />
						{title}
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-muted-foreground text-sm">{description}</p>
					<a
						href="mailto:assmann@hey.com"
						className="text-primary block text-sm pointer-fine:hover:underline"
					>
						{t("error.reportIssue")}
					</a>
					{error && (
						<details className="group">
							<summary className="text-muted-foreground pointer-fine:hover:text-foreground cursor-pointer text-sm font-medium">
								{t("error.showDetails")}
							</summary>
							<div className="mt-3 space-y-3">
								<div className="flex items-center justify-between">
									<p className="text-xs font-medium">
										{t("error.errorDetails")}
									</p>
									<Button variant="ghost" size="xs" onClick={handleCopyError}>
										<IconTransition
											active={copied ? "copied" : "copy"}
											icons={{
												copied: <Check className="size-3" />,
												copy: <Copy className="size-3" />,
											}}
											className="size-3"
										/>
										{copied ? t("common.copied") : t("common.copy")}
									</Button>
								</div>
								<div>
									<p className="mb-1 text-xs font-medium">
										{t("error.errorMessage")}
									</p>
									<pre className="bg-muted overflow-auto rounded p-3 text-xs select-text">
										{error.message}
									</pre>
								</div>
								{error.stack && (
									<details>
										<summary className="text-muted-foreground pointer-fine:hover:text-foreground cursor-pointer text-xs font-medium">
											{t("error.stackTrace")}
										</summary>
										<pre className="bg-muted mt-2 max-h-40 overflow-auto rounded p-3 text-xs select-text">
											{error.stack}
										</pre>
									</details>
								)}
								{componentStack && (
									<details>
										<summary className="text-muted-foreground pointer-fine:hover:text-foreground cursor-pointer text-xs font-medium">
											{t("error.componentStack")}
										</summary>
										<pre className="bg-muted mt-2 max-h-40 overflow-auto rounded p-3 text-xs select-text">
											{componentStack}
										</pre>
									</details>
								)}
							</div>
						</details>
					)}
				</CardContent>
				{actions && <CardFooter className="gap-2">{actions}</CardFooter>}
			</Card>
		</main>
	)
}
