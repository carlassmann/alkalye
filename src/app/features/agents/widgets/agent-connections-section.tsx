import { useState } from "react"
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
import {
	reconcilePersonalDocumentAccess,
	type AgentDocumentRole,
} from "../lib/personal-document-access"

export { AgentConnectionsSection, agentConnectionsQuery }

let agentConnectionsQuery = {
	root: {
		agentConnections: { $each: true },
		documents: { $each: true },
		inactiveDocuments: { $each: true },
		spaces: { $each: true },
	},
} as const

type AgentAccount = co.loaded<typeof UserAccount, typeof agentConnectionsQuery>

interface AgentConnectionsSectionProps {
	account: AgentAccount | null
	oauth?: string
}

type Role = AgentDocumentRole
type SharedResource =
	| { kind: "document"; value: co.loaded<typeof Document> }
	| { kind: "space"; value: co.loaded<typeof Space> }

function AgentConnectionsSection({
	account,
	oauth,
}: AgentConnectionsSectionProps) {
	let [busy, setBusy] = useState<string>()
	let [error, setError] = useState<string>()
	let connection = account?.root.agentConnections?.find(
		item => item?.$isLoaded && item.provider === "openai",
	)
	let authorization = oauth ? decodeAuthorization(oauth) : undefined

	async function connect() {
		if (!account) return
		setBusy("connect")
		setError(undefined)
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
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Connection failed")
		} finally {
			setBusy(undefined)
		}
	}

	async function authorize() {
		if (!connection?.$isLoaded || !authorization) return
		setBusy("authorize")
		setError(undefined)
		try {
			let response = await fetch("/api/oauth-approve", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					credential: connection.credential,
					authorization: authorization.authorization,
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

	async function disconnect() {
		if (!account || !connection?.$isLoaded) return
		setBusy("disconnect")
		setError(undefined)
		try {
			let agent = await UserAccount.load(connection.accountId)
			if (!agent.$isLoaded) throw new Error("Agent account is unavailable")
			let allResources = [
				...account.root.documents.values(),
				...(account.root.inactiveDocuments?.values() ?? []),
				...(account.root.spaces?.values() ?? []),
			]
			if (allResources.some(resource => !resource?.$isLoaded)) {
				throw new Error("Some shared items are still loading. Try again shortly.")
			}
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
			for (let resource of resources) {
				await removeAgentGrant(
					connection.credential,
					resource.kind,
					resource.value.$jazz.id,
				)
				resource.value.$jazz.owner.removeMember(agent)
			}
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
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Disconnect failed")
		} finally {
			setBusy(undefined)
		}
	}

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				Agent connections
			</h2>
			<div className="border-border bg-muted/20 border">
				<div className="flex items-start gap-3 p-4">
					<div className="bg-background border-border flex size-9 shrink-0 items-center justify-center border">
						<Bot className="size-4" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div>
								<div className="font-medium">My ChatGPT</div>
								<p className="text-muted-foreground mt-1 text-xs/relaxed">
									A separate encrypted collaborator. It sees only items you grant below.
								</p>
							</div>
							{connection?.$isLoaded ? (
								<Button
									variant="ghost"
									size="sm"
									onClick={disconnect}
									disabled={Boolean(busy)}
								>
									<Unplug /> Disconnect
								</Button>
							) : (
								<Button onClick={connect} disabled={!account || Boolean(busy)}>
									{busy === "connect" ? (
										<Loader2 className="animate-spin" />
									) : (
										<ShieldCheck />
									)}
									Connect ChatGPT
								</Button>
							)}
						</div>
						{authorization && (
							<div className="border-brand/30 bg-brand/5 mt-4 border p-3">
								<p className="text-sm font-medium">
									Authorize {authorization.client.name}
								</p>
								<p className="text-muted-foreground mt-1 text-xs/relaxed">
									This client can read or change only the personal documents and spaces granted below. OAuth scope: alkalye. Return destination: {authorization.client.redirectHost}.
								</p>
								<div className="mt-3 flex justify-end gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => window.location.assign("/app/settings")}
										disabled={Boolean(busy)}
									>
										Deny
									</Button>
									<Button
										variant="brand"
										size="sm"
										onClick={authorize}
										disabled={!connection?.$isLoaded || Boolean(busy)}
									>
										Authorize
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
			{error && <p className="text-destructive mt-2 text-xs">{error}</p>}
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
	let personalDocuments = account.root.documents.flatMap(document =>
		document?.$isLoaded
			? [{ kind: "document" as const, value: document }]
			: [],
	)
	let resources: SharedResource[] = [
		...(connection.personalDocumentsRole ? [] : personalDocuments),
		...(account.root.spaces ?? []).flatMap(space =>
			space?.$isLoaded ? [{ kind: "space" as const, value: space }] : [],
		),
	]

	return (
		<div className="border-border border-t">
			<div className="text-muted-foreground grid grid-cols-[1fr_6rem_3rem] gap-2 px-4 py-2 text-[11px] font-medium tracking-wide uppercase">
				<span>Personal documents or space</span>
				<span>Role</span>
				<span className="sr-only">Access</span>
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
	let id = "personal-documents"
	let enabled = Boolean(connection.personalDocumentsRole)
	let role: Role = connection.personalDocumentsRole ?? "reader"

	async function updateAccess(roleNext: Role | undefined) {
		setBusy(id)
		setError(undefined)
		try {
			if (roleNext) connection.$jazz.set("personalDocumentsRole", roleNext)
			await reconcilePersonalDocumentAccess(account, connection, roleNext)
			if (!roleNext) connection.$jazz.set("personalDocumentsRole", undefined)
		} catch (cause) {
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
		<div className="border-border grid grid-cols-[1fr_6rem_3rem] items-center gap-2 border-t px-4 py-3">
			<div className="min-w-0">
				<div className="truncate text-sm">Personal documents</div>
				<div className="text-muted-foreground text-[11px]">
					All current and future documents
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
				<SelectTrigger aria-label="Role for personal documents">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="reader">Read</SelectItem>
					<SelectItem value="writer">Write</SelectItem>
				</SelectContent>
			</Select>
			<Switch
				checked={enabled}
				onCheckedChange={checked =>
					void updateAccess(checked ? role : undefined)
				}
				disabled={busy === id}
				aria-label={`${enabled ? "Remove" : "Grant"} ChatGPT access to all personal documents`}
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
	let id = resource.value.$jazz.id
	let owner = resource.value.$jazz.owner
	let currentRole = owner.getRoleOf(connection.accountId)
	let role: Role = currentRole === "writer" ? "writer" : "reader"
	let enabled = currentRole === "reader" || currentRole === "writer"
	let label =
		resource.kind === "space"
			? resource.value.name
			: resource.value.title || "Untitled document"

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
			let response = await fetch("/api/agent-grants", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					credential: connection.credential,
					action: enabledNext ? "add" : "remove",
					resource: { kind: resource.kind, id },
				}),
			})
			if (!response.ok) throw new Error("Could not update agent access")
		} catch (cause) {
			restoreMembership?.()
			setError(cause instanceof Error ? cause.message : "Access update failed")
		} finally {
			setBusy(undefined)
		}
	}

	return (
		<div className="border-border grid grid-cols-[1fr_6rem_3rem] items-center gap-2 border-t px-4 py-3 first:border-t-0">
			<div className="min-w-0">
				<div className="truncate text-sm">{label}</div>
				<div className="text-muted-foreground text-[11px]">
					{resource.kind === "space" ? "Space" : "Document"}
				</div>
			</div>
			<Select
				value={role}
				onValueChange={value => {
					if ((value === "reader" || value === "writer") && enabled) {
						void updateAccess(true, value)
					}
				}}
				disabled={!enabled || busy === id}
			>
				<SelectTrigger aria-label={`Role for ${label}`}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="reader">Read</SelectItem>
					<SelectItem value="writer">Write</SelectItem>
				</SelectContent>
			</Select>
			<Switch
				checked={enabled}
				onCheckedChange={checked => void updateAccess(checked)}
				disabled={busy === id}
				aria-label={`${enabled ? "Remove" : "Grant"} ChatGPT access to ${label}`}
			/>
		</div>
	)
}

function decodeAuthorization(value: string):
	| {
			authorization: unknown
			client: { name: string; redirectHost: string }
	  }
	| undefined {
	try {
		let normalized = value.replaceAll("-", "+").replaceAll("_", "/")
		let padding = "=".repeat((4 - (normalized.length % 4)) % 4)
		let decoded: unknown = JSON.parse(atob(normalized + padding))
		if (!decoded || typeof decoded !== "object") return undefined
		if (!("authorization" in decoded) || !("client" in decoded)) return undefined
		let client = decoded.client
		if (!client || typeof client !== "object") return undefined
		if (!("name" in client) || typeof client.name !== "string") return undefined
		if (!("redirectHost" in client) || typeof client.redirectHost !== "string") {
			return undefined
		}
		return {
			authorization: decoded.authorization,
			client: { name: client.name, redirectHost: client.redirectHost },
		}
	} catch {
		return undefined
	}
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

async function removeAgentGrant(
	credential: string,
	kind: "document" | "space",
	id: string,
) {
	let response = await fetch("/api/agent-grants", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			credential,
			action: "remove",
			resource: { kind, id },
		}),
	})
	if (!response.ok) throw new Error("Could not remove all agent access")
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
