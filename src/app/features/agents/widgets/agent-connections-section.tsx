import { useEffect, useState } from "react"
import { Bot, Loader2, ShieldCheck, Unplug } from "lucide-react"
import { co } from "jazz-tools"
import { Button } from "@/app/components/ui/button"
import { Switch } from "@/app/components/ui/switch"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select"
import { AgentConnection, Document, Space, UserAccount } from "@/schema"
import { getDocumentTitle } from "@/app/features/documents"
import { useIntl } from "@/shared/intl/setup"
import { updateAgentGrants } from "../lib/agent-api"
import {
	reconcilePersonalDocumentAccess,
	type AgentDocumentRole,
} from "../lib/personal-document-access"

export { AgentConnectionsSection, agentConnectionsQuery }

let agentConnectionsQuery = {
	root: {
		agentConnections: { $each: true },
		documents: { $each: { content: true } },
		inactiveDocuments: { $each: { content: true } },
		spaces: { $each: true },
	},
} as const

type AgentAccount = co.loaded<typeof UserAccount, typeof agentConnectionsQuery>

interface AgentConnectionsSectionProps {
	account: AgentAccount | null
	isAuthenticated: boolean
	oauth?: string
}

type Role = AgentDocumentRole
type SharedResource =
	| {
			kind: "document"
			value: co.loaded<typeof Document, { content: true }>
	  }
	| { kind: "space"; value: co.loaded<typeof Space> }

function AgentConnectionsSection({
	account,
	isAuthenticated,
	oauth,
}: AgentConnectionsSectionProps) {
	let t = useIntl()
	let [busy, setBusy] = useState<string>()
	let [error, setError] = useState<string>()
	let [status, setStatus] = useState<string>()
	let [loadedAuthorization, setLoadedAuthorization] =
		useState<LoadedAuthorization>()
	let connection = account?.root.agentConnections?.find(
		item => item?.$isLoaded && item.provider === "openai",
	)
	let authorization =
		loadedAuthorization && loadedAuthorization.token === oauth
			? loadedAuthorization.authorization
			: undefined
	let hasAccess =
		account && connection?.$isLoaded
			? hasAgentAccess(account, connection)
			: false

	useEffect(() => {
		if (!oauth) {
			setLoadedAuthorization(undefined)
			return
		}
		setLoadedAuthorization(undefined)
		let controller = new AbortController()
		fetch(`/api/oauth-consent?token=${encodeURIComponent(oauth)}`, {
			signal: controller.signal,
		})
			.then(response => response.json())
			.then((value: unknown) => {
				if (isAuthorizationConsent(value)) {
					setLoadedAuthorization({ token: oauth, authorization: value })
				} else setError("This authorization request is invalid or expired")
			})
			.catch(cause => {
				if (cause instanceof Error && cause.name === "AbortError") return
				setError("Could not load the authorization request")
			})
		return () => controller.abort()
	}, [oauth])

	async function connect() {
		if (!account || !isAuthenticated) return
		setBusy("connect")
		setError(undefined)
		setStatus(undefined)
		try {
			let response = await fetch("/api/agent-connections", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ provider: "openai" }),
			})
			let result: unknown = await response.json()
			if (!response.ok || !isProvisionedConnection(result)) {
				throw new Error(
					readApiError(result, "Could not create the ChatGPT connection"),
				)
			}
			let list = account.root.agentConnections
			if (!list) {
				list = co.list(AgentConnection).create([], account.root.$jazz.owner)
				account.root.$jazz.set("agentConnections", list)
			}
			list.$jazz.push(
				AgentConnection.create(
					{
						provider: result.provider,
						accountId: result.accountId,
						credential: result.credential,
						createdAt: new Date(result.createdAt),
					},
					account.root.$jazz.owner,
				),
			)
			setStatus(t("settings.agents.ready"))
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Connection failed")
		} finally {
			setBusy(undefined)
		}
	}

	async function authorize() {
		if (!connection?.$isLoaded || !authorization || !oauth) return
		setBusy("authorize")
		setError(undefined)
		try {
			let response = await fetch("/api/oauth-approve", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					decision: "approve",
					credential: connection.credential,
					consent: oauth,
				}),
			})
			let result: unknown = await response.json()
			if (!response.ok || !hasRedirect(result)) {
				throw new Error("Could not authorize ChatGPT")
			}
			window.history.replaceState(null, "", "/app/settings")
			window.location.assign(result.redirectTo)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Authorization failed")
			setBusy(undefined)
		}
	}

	async function deny() {
		if (!authorization || !oauth) return
		setBusy("authorize")
		setError(undefined)
		try {
			let response = await fetch("/api/oauth-approve", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ decision: "deny", consent: oauth }),
			})
			let result: unknown = await response.json()
			if (!response.ok || !hasRedirect(result)) {
				throw new Error("Could not deny authorization")
			}
			window.history.replaceState(null, "", "/app/settings")
			window.location.assign(result.redirectTo)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Authorization failed")
			setBusy(undefined)
		}
	}

	async function disconnect() {
		if (!account || !connection?.$isLoaded) return
		setBusy("disconnect")
		setError(undefined)
		setStatus(undefined)
		let cleanupError: unknown
		try {
			let agent = await UserAccount.load(connection.accountId)
			let resources = [
				...account.root.documents.flatMap(document =>
					document?.$isLoaded
						? [{ kind: "document" as const, value: document }]
						: [],
				),
				...(account.root.inactiveDocuments ?? []).flatMap(document =>
					document?.$isLoaded
						? [{ kind: "document" as const, value: document }]
						: [],
				),
				...(account.root.spaces ?? []).flatMap(space =>
					space?.$isLoaded ? [{ kind: "space" as const, value: space }] : [],
				),
			]
			await updateAgentGrants(
				connection.credential,
				resources.map(resource => ({
					action: "remove",
					resource: { kind: resource.kind, id: resource.value.$jazz.id },
				})),
			)
			if (agent.$isLoaded) {
				for (let resource of resources) {
					let owner = resource.value.$jazz.owner
					if (owner.getRoleOf(account.$jazz.id) === "admin") {
						owner.removeMember(agent)
					}
				}
			} else cleanupError = new Error("Agent account is unavailable")
		} catch (cause) {
			cleanupError = cause
		}
		try {
			let revokeResponse = await fetch("/api/agent-connections", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ credential: connection.credential }),
			})
			if (!revokeResponse.ok) throw new Error("Could not revoke the connection")
			let index = account.root.agentConnections?.findIndex(
				item => item?.$jazz.id === connection.$jazz.id,
			)
			if (index !== undefined && index !== -1) {
				account.root.agentConnections?.$jazz.splice(index, 1)
			}
			setStatus(
				cleanupError
					? t("settings.agents.disconnectedWithCleanup")
					: t("settings.agents.disconnected"),
			)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Disconnect failed")
		} finally {
			setBusy(undefined)
		}
	}

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				{t("settings.agents.title")}
			</h2>
			<div className="border-border bg-muted/20 border">
				<div className="flex items-start gap-3 p-4">
					<div className="bg-background border-border flex size-9 shrink-0 items-center justify-center border">
						<Bot className="size-4" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="font-medium">My ChatGPT</div>
								<p className="text-muted-foreground mt-1 text-xs/relaxed">
									{t("settings.agents.description")}
								</p>
							</div>
							{connection?.$isLoaded ? (
								<Button
									variant="ghost"
									size="sm"
									className="shrink-0"
									onClick={disconnect}
									disabled={Boolean(busy)}
								>
									<Unplug /> {t("settings.agents.disconnect")}
								</Button>
							) : (
								<Button
									onClick={connect}
									disabled={!account || !isAuthenticated || Boolean(busy)}
								>
									{busy === "connect" ? (
										<Loader2 className="animate-spin" />
									) : (
										<ShieldCheck />
									)}
									{t("settings.agents.setup")}
								</Button>
							)}
						</div>
						{!isAuthenticated && !connection?.$isLoaded && (
							<p className="text-muted-foreground mt-3 text-xs/relaxed">
								{t("settings.agents.signIn")}
							</p>
						)}
						{status && (
							<p className="text-muted-foreground mt-3 text-xs/relaxed">
								{status}
							</p>
						)}
						{authorization && (
							<div className="border-brand/30 bg-brand/5 mt-4 border p-3">
								<p className="sr-only" role="status" aria-live="polite">
									{t("settings.agents.authorizationReady", {
										client: authorization.client.name,
									})}
								</p>
								<p className="text-sm font-medium">
									{t("settings.agents.authorize", {
										client: authorization.client.name,
									})}
								</p>
								<p className="text-muted-foreground mt-1 text-xs/relaxed">
									{t("settings.agents.consent", {
										host: authorization.client.redirectHost,
									})}
								</p>
								{!hasAccess && (
									<p className="text-destructive mt-2 text-xs/relaxed">
										{t("settings.agents.noAccess")}
									</p>
								)}
								<div className="mt-3 flex justify-end gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={deny}
										disabled={Boolean(busy)}
									>
										{t("settings.agents.deny")}
									</Button>
									<Button
										variant="brand"
										size="sm"
										onClick={authorize}
										disabled={!connection?.$isLoaded || Boolean(busy)}
									>
										{t("settings.agents.authorizeAndReturn")}
									</Button>
								</div>
							</div>
						)}
					</div>
				</div>
				{connection?.$isLoaded && account && (
					<ResourceAccess
						account={account}
						connection={connection}
						busy={busy}
						setBusy={setBusy}
						setError={setError}
					/>
				)}
			</div>
			{error && (
				<p className="text-destructive mt-2 text-xs" role="alert">
					{error}
				</p>
			)}
			<p className="sr-only" role="status" aria-live="polite">
				{status}
			</p>
		</section>
	)
}

interface ResourceAccessProps {
	account: AgentAccount
	connection: co.loaded<typeof AgentConnection>
	busy?: string
	setBusy(value: string | undefined): void
	setError(value: string | undefined): void
}

function ResourceAccess({
	account,
	connection,
	busy,
	setBusy,
	setError,
}: ResourceAccessProps) {
	let t = useIntl()
	let personalDocuments = account.root.documents.flatMap(document =>
		document?.$isLoaded ? [{ kind: "document" as const, value: document }] : [],
	)
	let resources: SharedResource[] = [
		...(connection.personalDocumentsRole ? [] : personalDocuments),
		...(account.root.spaces ?? []).flatMap(space =>
			space?.$isLoaded ? [{ kind: "space" as const, value: space }] : [],
		),
	]

	return (
		<div className="border-border border-t">
			<div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_4.5rem_2.5rem] gap-2 px-4 py-2 text-[11px] font-medium tracking-wide uppercase sm:grid-cols-[minmax(0,1fr)_6rem_3rem]">
				<span>{t("settings.agents.resources")}</span>
				<span>{t("settings.agents.role")}</span>
				<span className="sr-only">{t("settings.agents.access")}</span>
			</div>
			<PersonalDocumentsAccessRow
				account={account}
				connection={connection}
				busy={busy}
				setBusy={setBusy}
				setError={setError}
			/>
			{resources.map(resource => (
				<ResourceAccessRow
					key={`${resource.kind}:${resource.value.$jazz.id}`}
					resource={resource}
					connection={connection}
					busy={busy}
					setBusy={setBusy}
					setError={setError}
				/>
			))}
			{resources.some(resource => resource.kind === "space") && (
				<p className="text-muted-foreground border-border border-t px-4 py-3 text-xs/relaxed">
					{t("settings.agents.spaceDisclosure")}
				</p>
			)}
		</div>
	)
}

function PersonalDocumentsAccessRow({
	account,
	connection,
	busy,
	setBusy,
	setError,
}: ResourceAccessProps) {
	let t = useIntl()
	let id = "personal-documents"
	let enabled = Boolean(connection.personalDocumentsRole)
	let role: Role = connection.personalDocumentsRole ?? "reader"

	async function updateAccess(roleNext: Role | undefined) {
		setBusy(id)
		setError(undefined)
		let previousRole = connection.personalDocumentsRole
		try {
			connection.$jazz.set("personalDocumentsRole", roleNext)
			await reconcilePersonalDocumentAccess(account, connection, roleNext)
		} catch (cause) {
			connection.$jazz.set("personalDocumentsRole", previousRole)
			setError(
				cause instanceof Error
					? cause.message
					: "Personal document access failed",
			)
		} finally {
			setBusy(undefined)
		}
	}

	return (
		<div className="border-border grid grid-cols-[minmax(0,1fr)_4.5rem_2.5rem] items-center gap-2 border-t px-4 py-3 sm:grid-cols-[minmax(0,1fr)_6rem_3rem]">
			<div className="min-w-0">
				<div className="truncate text-sm">
					{t("settings.agents.personalDocuments")}
				</div>
				<div className="text-muted-foreground text-[11px]">
					{t("settings.agents.personalDocumentsDescription")}
				</div>
			</div>
			<Select
				value={role}
				onValueChange={value => {
					if ((value === "reader" || value === "writer") && enabled) {
						void updateAccess(value)
					}
				}}
				disabled={!enabled || busy === id}
			>
				<SelectTrigger
					aria-label={t("settings.agents.roleFor", {
						name: t("settings.agents.personalDocuments"),
					})}
				>
					<SelectValue>
						{t(
							role === "reader"
								? "settings.agents.read"
								: "settings.agents.write",
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="reader">{t("settings.agents.read")}</SelectItem>
					<SelectItem value="writer">{t("settings.agents.write")}</SelectItem>
				</SelectContent>
			</Select>
			<Switch
				checked={enabled}
				onCheckedChange={checked =>
					void updateAccess(checked ? role : undefined)
				}
				disabled={busy === id}
				aria-label={t(
					enabled
						? "settings.agents.removeAccess"
						: "settings.agents.grantAccess",
					{ name: t("settings.agents.personalDocuments") },
				)}
			/>
		</div>
	)
}

interface ResourceAccessRowProps {
	resource: SharedResource
	connection: co.loaded<typeof AgentConnection>
	busy?: string
	setBusy(value: string | undefined): void
	setError(value: string | undefined): void
}

function ResourceAccessRow({
	resource,
	connection,
	busy,
	setBusy,
	setError,
}: ResourceAccessRowProps) {
	let t = useIntl()
	let id = resource.value.$jazz.id
	let owner = resource.value.$jazz.owner
	let currentRole = owner.getRoleOf(connection.accountId)
	let canManage = owner.myRole() === "admin"
	let role: Role = currentRole === "writer" ? "writer" : "reader"
	let enabled = currentRole === "reader" || currentRole === "writer"
	let label =
		resource.kind === "space"
			? resource.value.name
			: getDocumentTitle(resource.value) || t("settings.agents.untitled")

	async function updateAccess(enabledNext: boolean, roleNext: Role = role) {
		setBusy(id)
		setError(undefined)
		let restoreMembership: (() => void) | undefined
		try {
			let agent = await UserAccount.load(connection.accountId)
			if (!agent.$isLoaded) throw new Error("Agent account is unavailable")
			if (enabledNext) owner.addMember(agent, roleNext)
			else owner.removeMember(agent)
			restoreMembership = () => {
				if (currentRole === "reader" || currentRole === "writer") {
					owner.addMember(agent, currentRole)
				} else {
					owner.removeMember(agent)
				}
			}
			await updateAgentGrants(connection.credential, [
				{
					action: enabledNext ? "add" : "remove",
					resource: { kind: resource.kind, id },
				},
			])
		} catch (cause) {
			restoreMembership?.()
			setError(cause instanceof Error ? cause.message : "Access update failed")
		} finally {
			setBusy(undefined)
		}
	}

	return (
		<div className="border-border grid grid-cols-[minmax(0,1fr)_4.5rem_2.5rem] items-center gap-2 border-t px-4 py-3 sm:grid-cols-[minmax(0,1fr)_6rem_3rem]">
			<div className="min-w-0">
				<div className="truncate text-sm">{label}</div>
				<div className="text-muted-foreground text-[11px]">
					{!canManage
						? t("settings.agents.adminRequired")
						: resource.kind === "space"
							? t("settings.agents.space")
							: t("settings.agents.document")}
				</div>
			</div>
			<Select
				value={role}
				onValueChange={value => {
					if ((value === "reader" || value === "writer") && enabled) {
						void updateAccess(true, value)
					}
				}}
				disabled={!canManage || !enabled || busy === id}
			>
				<SelectTrigger
					aria-label={t("settings.agents.roleFor", { name: label })}
				>
					<SelectValue>
						{t(
							role === "reader"
								? "settings.agents.read"
								: "settings.agents.write",
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="reader">{t("settings.agents.read")}</SelectItem>
					<SelectItem value="writer">{t("settings.agents.write")}</SelectItem>
				</SelectContent>
			</Select>
			<Switch
				checked={enabled}
				onCheckedChange={checked => void updateAccess(checked)}
				disabled={!canManage || busy === id}
				aria-label={t(
					enabled
						? "settings.agents.removeAccess"
						: "settings.agents.grantAccess",
					{ name: label },
				)}
			/>
		</div>
	)
}

interface AuthorizationConsent {
	authorization: unknown
	client: { name: string; redirectHost: string }
}

interface LoadedAuthorization {
	token: string
	authorization: AuthorizationConsent
}

function isAuthorizationConsent(value: unknown): value is AuthorizationConsent {
	if (!value || typeof value !== "object") return false
	if (!("authorization" in value) || !("client" in value)) return false
	let client = value.client
	if (!client || typeof client !== "object") return false
	return (
		"name" in client &&
		typeof client.name === "string" &&
		"redirectHost" in client &&
		typeof client.redirectHost === "string"
	)
}

function isProvisionedConnection(value: unknown): value is {
	provider: "openai"
	accountId: string
	credential: string
	createdAt: string
} {
	if (!value || typeof value !== "object") return false
	return (
		"provider" in value &&
		value.provider === "openai" &&
		"accountId" in value &&
		typeof value.accountId === "string" &&
		"credential" in value &&
		typeof value.credential === "string" &&
		"createdAt" in value &&
		typeof value.createdAt === "string"
	)
}

function hasRedirect(value: unknown): value is { redirectTo: string } {
	return Boolean(
		value &&
		typeof value === "object" &&
		"redirectTo" in value &&
		typeof value.redirectTo === "string",
	)
}

function readApiError(value: unknown, fallback: string) {
	if (
		value &&
		typeof value === "object" &&
		"error" in value &&
		typeof value.error === "string"
	) {
		return value.error
	}
	return fallback
}

function hasAgentAccess(
	account: AgentAccount,
	connection: co.loaded<typeof AgentConnection>,
) {
	if (connection.personalDocumentsRole) return true
	let resources = [
		...account.root.documents.values(),
		...(account.root.spaces?.values() ?? []),
	]
	return resources.some(resource => {
		if (!resource?.$isLoaded) return false
		let role = resource.$jazz.owner.getRoleOf(connection.accountId)
		return role === "reader" || role === "writer"
	})
}
