import { IconTransition } from "@/app/components/ui/icon-transition"
import { useState } from "react"
import { usePassphraseAuth } from "jazz-tools/react"
import { Copy, Check, RefreshCw } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/app/components/ui/dialog"
import { Textarea } from "@/app/components/ui/textarea"
import { wordlist } from "../lib/wordlist"
import { testIds } from "@/app/lib/test-ids"
import { getRandomWriterName } from "@/schema"
import { useIntl, T } from "@/shared/intl/setup"

export { AuthForm, AuthDialog }

interface AuthFormProps {
	onSuccess?: () => void
}

interface AuthDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
	title?: string
	description?: string
}

function AuthDialog({
	open,
	onOpenChange,
	onSuccess,
	title,
	description,
}: AuthDialogProps) {
	let t = useIntl()
	let resolvedTitle = title ?? t("auth.dialog.defaultTitle")

	function handleSuccess() {
		onOpenChange(false)
		onSuccess?.()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid={testIds.auth.dialog}>
				<DialogHeader>
					<DialogTitle>{resolvedTitle}</DialogTitle>
					{description && <DialogDescription>{description}</DialogDescription>}
				</DialogHeader>
				<AuthForm onSuccess={handleSuccess} />
			</DialogContent>
		</Dialog>
	)
}

function AuthForm({ onSuccess }: AuthFormProps) {
	let t = useIntl()
	let auth = usePassphraseAuth({ wordlist })
	let [step, setStep] = useState<"initial" | "create" | "login">("initial")
	let [loginPassphrase, setLoginPassphrase] = useState("")
	let [isCopied, setIsCopied] = useState(false)
	let [currentPassphrase, setCurrentPassphrase] = useState(() =>
		auth.generateRandomPassphrase(),
	)
	let [error, setError] = useState("")

	function handleReroll() {
		setCurrentPassphrase(auth.generateRandomPassphrase())
		setIsCopied(false)
	}

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(currentPassphrase)
			setError("")
			setIsCopied(true)
		} catch (e) {
			setIsCopied(false)
			setError(e instanceof Error ? e.message : t("auth.create.copyError"))
		}
	}

	async function handleRegister() {
		try {
			await auth.registerNewAccount(currentPassphrase, getRandomWriterName())
			onSuccess?.()
		} catch (e) {
			setError(
				e instanceof Error ? e.message : t("auth.create.error.registerFailed"),
			)
		}
	}

	async function handleLogin() {
		try {
			setError("")
			await auth.logIn(loginPassphrase)
			onSuccess?.()
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: t("auth.login.error.invalidPassphrase"),
			)
		}
	}

	return (
		<div>
			{step === "initial" && (
				<>
					<p className="text-muted-foreground mb-4 text-sm">
						<T k="auth.initial.description" />
					</p>
					<div className="flex flex-col justify-end gap-2">
						<Button
							onClick={() => setStep("create")}
							size="sm"
							data-testid={testIds.auth.initialCreateAccount}
						>
							<T k="auth.initial.createAccount" />
						</Button>
						<Button
							onClick={() => setStep("login")}
							variant="outline"
							size="sm"
							data-testid={testIds.auth.initialSignIn}
						>
							<T k="auth.initial.signIn" />
						</Button>
					</div>
				</>
			)}

			{step === "create" && (
				<>
					<h3 className="mb-2 font-medium">
						<T k="auth.create.title" />
					</h3>
					<p className="text-muted-foreground mb-12 text-sm">
						<T k="auth.create.description" />
					</p>
					<Textarea
						readOnly
						value={currentPassphrase}
						data-testid={testIds.auth.createPassphrase}
						className="bg-background border-border mb-3 w-full resize-none rounded-md border p-3 font-mono text-sm"
						minRows={3}
					/>
					<div className="mb-3 flex gap-2">
						<Button
							onClick={handleCopy}
							variant="outline"
							size="sm"
							className="flex-1"
							data-testid={testIds.auth.createCopy}
						>
							<IconTransition
								active={isCopied ? "copied" : "copy"}
								icons={{
									copied: <Check className="size-3.5" />,
									copy: <Copy className="size-3.5" />,
								}}
								className="mr-1 size-3.5"
							/>
							{isCopied ? (
								<T k="auth.create.copied" />
							) : (
								<T k="auth.create.copy" />
							)}
						</Button>
						<Button
							onClick={handleReroll}
							variant="outline"
							size="sm"
							data-testid={testIds.auth.createReroll}
						>
							<RefreshCw className="size-3.5" />
						</Button>
					</div>
					{error && (
						<p
							className="text-destructive mb-3 text-sm"
							data-testid={testIds.auth.createError}
						>
							{error}
						</p>
					)}
					<div className="mt-12 flex justify-end gap-2">
						<Button
							onClick={() => setStep("initial")}
							variant="ghost"
							size="sm"
							className="flex-1"
							data-testid={testIds.auth.createBack}
						>
							<T k="auth.create.back" />
						</Button>
						<Button
							onClick={handleRegister}
							size="sm"
							disabled={!isCopied}
							className="flex-1"
							data-testid={testIds.auth.createSubmit}
						>
							<T k="auth.create.submit" />
						</Button>
					</div>
				</>
			)}

			{step === "login" && (
				<>
					<h3 className="mb-2 font-medium">
						<T k="auth.login.title" />
					</h3>
					<p className="text-muted-foreground mb-4 text-sm">
						<T k="auth.login.description" />
					</p>
					<Textarea
						value={loginPassphrase}
						onChange={e => setLoginPassphrase(e.target.value)}
						placeholder={t("auth.login.placeholder")}
						data-testid={testIds.auth.loginPassphrase}
						className="bg-background border-border mb-3 w-full resize-none rounded-md border p-3 font-mono text-sm"
						minRows={3}
					/>
					{error && (
						<p
							className="text-destructive mb-3 text-sm"
							data-testid={testIds.auth.loginError}
						>
							{error}
						</p>
					)}
					<div className="flex gap-2">
						<Button
							onClick={() => {
								setStep("initial")
								setError("")
							}}
							variant="ghost"
							size="sm"
							className="flex-1"
							data-testid={testIds.auth.loginBack}
						>
							<T k="auth.login.back" />
						</Button>
						<Button
							onClick={handleLogin}
							size="sm"
							disabled={!loginPassphrase.trim()}
							className="flex-1"
							data-testid={testIds.auth.loginSubmit}
						>
							<T k="auth.login.submit" />
						</Button>
					</div>
				</>
			)}
		</div>
	)
}
