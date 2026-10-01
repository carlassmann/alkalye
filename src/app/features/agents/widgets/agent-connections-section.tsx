import { useEffect, useState } from "react"
import { Copy, Globe2 } from "lucide-react"
import type { co } from "jazz-tools"
import { AuthDialog } from "@/app/features/auth"
import { Button } from "@/app/components/ui/button"
import { McpConnection, UserAccount } from "@/schema"
import { useIntl } from "@/shared/intl/setup"
import {
	SettingsSection,
	SettingsPanel,
} from "@/app/components/ui/settings-layout"
import { readJsonResponse, disconnectMcpConnection } from "../lib/agent-api"

export { AgentConnectionsSection, agentConnectionsQuery }

let agentConnectionsQuery = {
	root: { mcpConnections: { $each: true } },
} as const

type User = co.loaded<typeof UserAccount, typeof agentConnectionsQuery>
interface AgentConnectionsSectionProps {
	account: User | null
	isAuthenticated: boolean
	oauth?: string
}
interface Consent {
	authorization: { client_id: string }
	client: { name: string; redirectHost: string }
}

function AgentConnectionsSection({
	account,
	isAuthenticated,
	oauth,
}: AgentConnectionsSectionProps) {
	let t = useIntl()
	let [busy, setBusy] = useState(false)
	let [authOpen, setAuthOpen] = useState(false)
	let [error, setError] = useState<string>()
	let [status, setStatus] = useState<string>()
	let [consent, setConsent] = useState<{ token: string; value: Consent }>()
	let [copied, setCopied] = useState(false)
	let endpoint = `${window.location.origin}/mcp`
	let authorization =
		consent && consent.token === oauth ? consent.value : undefined

	useEffect(() => {
		if (!oauth) return
		let controller = new AbortController()
		fetch(`/api/oauth-consent?token=${encodeURIComponent(oauth)}`, {
			signal: controller.signal,
		})
			.then(readJsonResponse)
			.then((value: unknown) => {
				if (!isConsent(value)) throw new Error("Invalid authorization request")
				setConsent({ token: oauth, value })
			})
			.catch(cause => {
				if (controller.signal.aborted) return
				setError(
					cause instanceof Error ? cause.message : "Authorization failed",
				)
			})
		return () => controller.abort()
	}, [oauth])

	async function authorize(decision: "approve" | "deny") {
		if (!oauth || !authorization) return
		if (decision === "approve" && (!account || !isAuthenticated)) return
		setBusy(true)
		setError(undefined)
		try {
			let credentials =
				decision === "approve" && account
					? {
							accountId: account.$jazz.id,
							accountSecret:
								account.$jazz.localNode.getCurrentAgent().agentSecret,
						}
					: undefined
			let response = await fetch("/api/oauth-approve", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ decision, consent: oauth, credentials }),
			})
			let result = await readJsonResponse(response)
			if (!response.ok || !hasRedirect(result))
				throw new Error("Authorization failed")
			window.history.replaceState(null, "", "/app/settings")
			window.location.assign(result.redirectTo)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Authorization failed")
			setBusy(false)
		}
	}

	function openSignIn() {
		setAuthOpen(true)
	}
	function signedIn() {
		setAuthOpen(false)
	}
	function handleAuthorize() {
		void authorize("approve")
	}
	function handleDeny() {
		void authorize("deny")
	}
	function handleDisconnect(connection: co.loaded<typeof McpConnection>) {
		return async function disconnect() {
			setBusy(true)
			setError(undefined)
			try {
				await disconnectMcpConnection(connection, async () => {
					if (account)
						await account.$jazz.waitForAllCoValuesSync({ timeout: 10_000 })
				})
				setStatus(t("settings.agents.revoked"))
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : "Disconnect failed")
			} finally {
				setBusy(false)
			}
		}
	}
	async function copyEndpoint() {
		try {
			await navigator.clipboard.writeText(endpoint)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch {
			setError("Could not copy MCP URL")
		}
	}

	return (
		<SettingsSection title={t("settings.agents.title")}>
			<SettingsPanel>
				<div className="flex items-start gap-3 p-4">
					<Globe2 className="mt-1 size-4 shrink-0" />
					<div className="min-w-0 flex-1">
						<p className="font-medium">{t("settings.agents.mcpTitle")}</p>
						<p className="text-muted-foreground mt-1 text-xs/relaxed">
							{t("settings.agents.mcpDescription")}
						</p>
						<div className="border-border mt-3 flex items-center gap-2 border p-2">
							<code className="min-w-0 flex-1 overflow-auto text-xs select-all">
								{endpoint}
							</code>
							<Button
								variant="ghost"
								size="xs"
								onClick={copyEndpoint}
								aria-label={t("settings.agents.copyMcpEndpoint")}
							>
								<Copy className="size-3" />
								{copied ? t("common.copied") : t("common.copy")}
							</Button>
						</div>
						<p className="text-muted-foreground mt-3 text-xs/relaxed">
							{t("settings.agents.description")}
						</p>
					</div>
				</div>
				{!isAuthenticated && (
					<div className="space-y-3 p-4">
						<p className="text-muted-foreground text-sm">
							{t("settings.agents.signIn")}
						</p>
						<Button variant="outline" onClick={openSignIn}>
							{t("settings.sync.signIn")}
						</Button>
					</div>
				)}
				{authorization && (
					<div className="border-border space-y-3 border-t p-4">
						<p className="font-medium">
							{t("settings.agents.authorize", {
								client: new URL(authorization.authorization.client_id).host,
							})}
						</p>
						<p className="text-muted-foreground text-sm">
							{t("settings.agents.clientName", {
								name: authorization.client.name,
							})}
						</p>
						<p className="font-mono text-xs break-all">
							{authorization.authorization.client_id}
						</p>
						<p className="text-muted-foreground text-xs/relaxed">
							{t("settings.agents.consent", {
								host: authorization.client.redirectHost,
							})}
						</p>
						<div className="flex gap-2">
							<Button
								disabled={busy || !isAuthenticated || !account}
								onClick={handleAuthorize}
							>
								{t("settings.agents.authorize", {
									client: new URL(authorization.authorization.client_id).host,
								})}
							</Button>
							<Button variant="outline" disabled={busy} onClick={handleDeny}>
								{t("settings.agents.deny")}
							</Button>
						</div>
					</div>
				)}
				{(account?.root.mcpConnections ?? [])
					.filter(connection => !connection.revokedAt)
					.map(connection => (
						<div
							key={connection.$jazz.id}
							className="border-border flex items-center justify-between gap-3 border-t p-4"
						>
							<div className="min-w-0">
								<p className="font-medium">
									{new URL(connection.clientId).host}
								</p>
								<p className="text-muted-foreground text-xs">
									{t("settings.agents.clientName", {
										name: connection.clientName,
									})}
								</p>
								<p className="text-muted-foreground truncate text-xs">
									{connection.clientId}
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								disabled={busy || !isAuthenticated}
								onClick={handleDisconnect(connection)}
							>
								{t("settings.agents.disconnect")}
							</Button>
						</div>
					))}
				{status && (
					<p role="status" className="text-muted-foreground p-4 text-sm">
						{status}
					</p>
				)}
				{error && (
					<p role="alert" className="text-destructive p-4 text-sm">
						{error}
					</p>
				)}
			</SettingsPanel>
			<AuthDialog
				open={authOpen}
				onOpenChange={setAuthOpen}
				onSuccess={signedIn}
			/>
		</SettingsSection>
	)
}

function isConsent(value: unknown): value is Consent {
	if (
		!value ||
		typeof value !== "object" ||
		!("client" in value) ||
		!("authorization" in value)
	)
		return false
	let client = value.client
	let authorization = value.authorization
	if (
		!client ||
		typeof client !== "object" ||
		!("name" in client) ||
		typeof client.name !== "string" ||
		!("redirectHost" in client) ||
		typeof client.redirectHost !== "string"
	)
		return false
	if (
		!authorization ||
		typeof authorization !== "object" ||
		!("client_id" in authorization) ||
		typeof authorization.client_id !== "string"
	)
		return false
	try {
		return new URL(authorization.client_id).protocol === "https:"
	} catch {
		return false
	}
}

function hasRedirect(value: unknown): value is { redirectTo: string } {
	return Boolean(
		value &&
		typeof value === "object" &&
		"redirectTo" in value &&
		typeof value.redirectTo === "string",
	)
}
