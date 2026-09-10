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
				throw new Error("Could not create the ChatGPT connection")
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
		if (!connection?.$isLoaded || !oauth) return
		setBusy("authorize")
		setError(undefined)
		try {
			let authorization = decodeAuthorization(oauth)
			let response = await fetch("/api/oauth-approve", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					credential: connection.credential,
					authorization,
				}),
			})
			let result: unknown = await response.json()
			if (!response.ok || !hasRedirect(result)) {
				throw new Error("Could not authorize ChatGPT")
			}
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
			if (agent.$isLoaded) {
				account.root.documents.forEach(document => {
					if (document?.$isLoaded) document.$jazz.owner.removeMember(agent)
				})
				account.root.inactiveDocuments?.forEach(document => {
					if (document?.$isLoaded) document.$jazz.owner.removeMember(agent)
				})
				account.root.spaces?.forEach(space => {
					if (space?.$isLoaded) space.$jazz.owner.removeMember(agent)
				})
			}
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
						{oauth && (
							<div className="border-brand/30 bg-brand/5 mt-4 flex items-center justify-between gap-3 border p-3">
								<p className="text-xs">
									ChatGPT is waiting for this Alkalye connection.
								</p>
								<Button
									variant="brand"
									size="sm"
									onClick={authorize}
									disabled={!connection?.$isLoaded || Boolean(busy)}
								>
									Authorize
								</Button>
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
			await reconcilePersonalDocumentAccess(account, connection, roleNext)
			connection.$jazz.set("personalDocumentsRole", roleNext)
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
		try {
			let agent = await UserAccount.load(connection.accountId)
			if (!agent.$isLoaded) throw new Error("Agent account is unavailable")
			if (enabledNext) owner.addMember(agent, roleNext)
			else owner.removeMember(agent)
			let response = await fetch("/api/agent-grants", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					credential: connection.credential,
					action: enabledNext ? "add" : "remove",
					resource: { kind: resource.kind, id },
				}),
			})
			if (!response.ok) {
				if (enabledNext) owner.removeMember(agent)
				throw new Error("Could not update agent access")
			}
		} catch (cause) {
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

function decodeAuthorization(value: string): unknown {
	let normalized = value.replaceAll("-", "+").replaceAll("_", "/")
	let padding = "=".repeat((4 - (normalized.length % 4)) % 4)
	return JSON.parse(atob(normalized + padding))
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
