export { renderCustomHelp, descriptions }

let descriptions = {
	auth: "Passphrase authentication.",
	account: "Account profile.",
	doc: "Personal and shared document workflows.",
	theme: "Create and manage document and slideshow themes.",
	docComment: "Document comments.",
	docShare: "Document sharing.",
	docPublic: "Document public access.",
	space: "Shared spaces and membership.",
	spaceShare: "Space sharing.",
	spacePublic: "Space public access.",
	invite: "Inspect and accept invite links.",
	sync: "Explicit remote sync commands.",
} as const

function renderCustomHelp(args: string[], version: string): string | undefined {
	let isHelp =
		args.length === 0 || args.includes("--help") || args.includes("-h")
	if (!isHelp) return undefined

	let path = args.filter(arg => !arg.startsWith("-")).join(" ")

	if (path === "") return renderRootHelp(version)
	if (path in groups) return renderGroupHelp(path, groups[path])
	if (path in leaves) return renderLeafHelp(path, leaves[path])
	return undefined
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type GroupDef = {
	description: string
	sections: { heading: string; items: [name: string, summary: string][] }[]
	examples?: string[]
}

type LeafDef = {
	summary: string
	usage: string
	options?: string[]
	examples?: string[]
}

let groups: Record<string, GroupDef> = {
	theme: {
		description: descriptions.theme,
		sections: [
			{
				heading: "Commands",
				items: [
					["list", "List your themes"],
					["get", "Read a theme and its editable source"],
					["create", "Create and compile a Markdown theme source"],
					["update", "Update and compile an existing theme"],
					["delete", "Remove a theme from your library"],
				],
			},
		],
		examples: [
			'alkalye theme create --name "My theme" --source theme.md --json',
			"alkalye theme update co_xyz --source theme.md --json",
		],
	},
	auth: {
		description: descriptions.auth,
		sections: [
			{
				heading: "Commands",
				items: [
					["signup", "Create account and store credentials locally"],
					["login", "Log in with an existing passphrase"],
					["logout", "Clear local credentials"],
					["whoami", "Show current account"],
					["passphrase", "Print stored passphrase"],
				],
			},
		],
		examples: [
			'alkalye auth signup --name "Carl"',
			"alkalye auth login --passphrase-stdin < passphrase.txt",
			"alkalye auth whoami --json",
		],
	},
	account: {
		description: descriptions.account,
		sections: [
			{
				heading: "Commands",
				items: [
					["show", "Show account profile with document and space counts"],
					["rename", "Rename current account"],
				],
			},
		],
	},
	doc: {
		description: descriptions.doc,
		sections: [
			{
				heading: "Core commands",
				items: [
					["list", "List documents (--scope personal|all|space:<id>)"],
					["get", "Show document metadata"],
					["content", "Print raw document content (pipe-friendly)"],
					["create", "Create a document"],
					["update", "Replace document content"],
					["rename", "Rename document title"],
					["move", "Move document to personal or space scope"],
					["delete", "Soft-delete a document"],
					["restore", "Restore a soft-deleted document"],
					["purge", "Permanently delete a document"],
					["leave", "Leave a shared personal document"],
				],
			},
			{
				heading: "Groups",
				items: [
					["comment", "Inline document comments"],
					["share", "Invite and role management"],
					["public", "Public/private access controls"],
				],
			},
		],
	},
	"doc comment": {
		description: descriptions.docComment,
		sections: [
			{
				heading: "Commands",
				items: [
					["list", "List comment threads"],
					["add", "Add an inline comment"],
					["reply", "Reply to a comment thread"],
					["resolve", "Resolve a comment thread"],
					["reopen", "Reopen a resolved comment thread"],
					["delete", "Delete a comment thread"],
					["enable", "Enable comments for a document"],
					["disable", "Disable comments for a document"],
				],
			},
		],
	},
	"doc share": {
		description: descriptions.docShare,
		sections: [
			{
				heading: "Commands",
				items: [
					["create", "Create an invite link"],
					["revoke", "Revoke an invite group"],
					["list", "List collaborators"],
					["role", "Change a collaborator's role"],
				],
			},
		],
	},
	"doc public": {
		description: descriptions.docPublic,
		sections: [
			{
				heading: "Commands",
				items: [
					["enable", "Make publicly accessible"],
					["disable", "Make private"],
					["link", "Get the public link"],
				],
			},
		],
	},
	space: {
		description: descriptions.space,
		sections: [
			{
				heading: "Core commands",
				items: [
					["list", "List spaces"],
					["get", "Show space metadata"],
					["members", "List members"],
					["docs", "List documents in a space"],
					["create", "Create a space"],
					["rename", "Rename a space"],
					["delete", "Permanently delete a space"],
					["leave", "Leave a shared space"],
				],
			},
			{
				heading: "Groups",
				items: [
					["share", "Invite and role management"],
					["public", "Public/private access controls"],
				],
			},
		],
	},
	"space share": {
		description: descriptions.spaceShare,
		sections: [
			{
				heading: "Commands",
				items: [
					["create", "Create an invite link"],
					["revoke", "Revoke an invite group"],
					["list", "List collaborators"],
					["role", "Change a collaborator's role"],
				],
			},
		],
	},
	"space public": {
		description: descriptions.spacePublic,
		sections: [
			{
				heading: "Commands",
				items: [
					["enable", "Make publicly accessible"],
					["disable", "Make private"],
					["link", "Get the public link"],
				],
			},
		],
	},
	invite: {
		description: descriptions.invite,
		sections: [
			{
				heading: "Commands",
				items: [
					["inspect", "Inspect an invite link without accepting"],
					["accept", "Accept an invite link"],
				],
			},
		],
	},
	sync: {
		description: descriptions.sync,
		sections: [
			{
				heading: "Commands",
				items: [
					["flush", "Wait for all local changes to sync"],
					["status", "Show sync and authentication status"],
				],
			},
		],
	},
}

let leaves: Record<string, LeafDef> = {
	"theme list": {
		summary: "List your themes.",
		usage: "alkalye theme list",
	},
	"theme get": {
		summary: "Read a theme, compiled styles, and editable Markdown source.",
		usage: "alkalye theme get <theme-id>",
	},
	"theme create": {
		summary: "Create a theme and compile its Markdown source immediately.",
		usage: "alkalye theme create --source <file> [--name <name>]",
		options: [
			"--source <file>       Markdown with css theme and optional html document/slide fences",
			"--name <name>         Theme display name",
		],
	},
	"theme update": {
		summary:
			"Update an existing theme and compile its Markdown source immediately.",
		usage: "alkalye theme update <theme-id> --source <file> [--name <name>]",
		options: [
			"--source <file>       Updated Markdown theme source",
			"--name <name>         Rename while preserving theme assignments",
		],
	},
	"theme delete": {
		summary: "Remove a theme from your library.",
		usage: "alkalye theme delete <theme-id>",
	},
	// auth
	"auth signup": {
		summary: "Create account and store credentials locally.",
		usage: "alkalye auth signup [options]",
		options: [
			"--name <name>           Display name (random if omitted)",
			"--passphrase <str>      Use specific passphrase (visible in shell history)",
			"--passphrase-file <f>   Read passphrase from file",
			"--passphrase-stdin      Read passphrase from stdin",
		],
		examples: [
			'alkalye auth signup --name "Alice"',
			"alkalye auth signup --passphrase-stdin < phrase.txt",
		],
	},
	"auth login": {
		summary: "Log in with an existing passphrase.",
		usage: "alkalye auth login <passphrase option>",
		options: [
			"--passphrase <str>      Passphrase string (visible in shell history)",
			"--passphrase-file <f>   Read passphrase from file",
			"--passphrase-stdin      Read passphrase from stdin",
		],
		examples: ["alkalye auth login --passphrase-stdin < phrase.txt"],
	},
	"auth logout": {
		summary: "Clear local credentials.",
		usage: "alkalye auth logout",
	},
	"auth whoami": {
		summary: "Show current account.",
		usage: "alkalye auth whoami",
		examples: ["alkalye auth whoami --json"],
	},
	"auth passphrase": {
		summary: "Print stored passphrase.",
		usage: "alkalye auth passphrase",
	},

	// account
	"account show": {
		summary: "Show account profile with document and space counts.",
		usage: "alkalye account show",
		examples: ["alkalye account show --json"],
	},
	"account rename": {
		summary: "Rename current account.",
		usage: "alkalye account rename --name <name>",
		options: ["--name <name>   New display name"],
	},
	// doc
	"doc list": {
		summary: "List documents.",
		usage: "alkalye doc list [options]",
		options: [
			"--scope <scope>   personal (default), all, or space:<id>",
			"--deleted         Show deleted documents instead of active",
		],
		examples: [
			"alkalye doc list",
			"alkalye doc list --scope all",
			"alkalye doc list --scope space:co_xyz --json",
			"alkalye doc list --deleted",
		],
	},
	"doc get": {
		summary: "Show document metadata.",
		usage: "alkalye doc get <doc-id>",
		options: [
			"--offline      Use cached local data without remote freshness checks",
			"--local        Alias for --offline",
			"--stale-ok     Allow cached data if remote sync is incomplete",
		],
		examples: ["alkalye doc get co_xyz --json"],
	},
	"doc content": {
		summary: "Print raw document content (pipe-friendly).",
		usage: "alkalye doc content <doc-id>",
		options: [
			"--offline      Use cached local data without remote freshness checks",
			"--local        Alias for --offline",
			"--stale-ok     Allow cached data if remote sync is incomplete",
		],
		examples: [
			"alkalye doc content co_xyz",
			"alkalye doc content co_xyz | head -20",
			"alkalye doc content co_xyz --json",
		],
	},
	"doc create": {
		summary: "Create a document.",
		usage: "alkalye doc create <content option> [options]",
		options: [
			"--content <str>       Inline content (supports \\n for newlines)",
			"--content-file <f>    Read content from file",
			"--stdin               Read content from stdin",
			"--scope <scope>       personal (default) or space:<id>",
			"--sync                Wait for remote sync",
		],
		examples: [
			'echo "# My Doc\\n\\nBody" | alkalye doc create --stdin',
			"alkalye doc create --content-file draft.md",
			'alkalye doc create --content "# Quick Note\\nSome text"',
			"alkalye doc create --stdin --scope space:co_xyz < doc.md",
		],
	},
	"doc update": {
		summary: "Replace document content.",
		usage: "alkalye doc update <doc-id> <content option>",
		options: [
			"--content <str>       Inline content (supports \\n for newlines)",
			"--content-file <f>    Read content from file",
			"--stdin               Read content from stdin",
			"--sync                Wait for remote sync",
		],
		examples: [
			"cat updated.md | alkalye doc update co_xyz --stdin",
			"alkalye doc update co_xyz --content-file new.md",
		],
	},
	"doc rename": {
		summary: "Rename document title.",
		usage: "alkalye doc rename <doc-id> --title <title>",
		options: ["--title <title>   New document title"],
		examples: ['alkalye doc rename co_xyz --title "New Title"'],
	},
	"doc move": {
		summary: "Move document to personal or space scope.",
		usage: "alkalye doc move <doc-id> --scope <scope>",
		options: ["--scope <scope>   personal or space:<id>"],
		examples: [
			"alkalye doc move co_xyz --scope space:co_abc",
			"alkalye doc move co_xyz --scope personal",
		],
	},
	"doc delete": {
		summary: "Soft-delete a document (can be restored).",
		usage: "alkalye doc delete <doc-id>",
	},
	"doc restore": {
		summary: "Restore a soft-deleted document.",
		usage: "alkalye doc restore <doc-id>",
	},
	"doc purge": {
		summary: "Permanently delete a document.",
		usage: "alkalye doc purge <doc-id>",
	},
	"doc leave": {
		summary: "Leave a shared personal document.",
		usage: "alkalye doc leave <doc-id>",
	},
	"doc comment list": {
		summary: "List document comments.",
		usage: "alkalye doc comment list <doc-id>",
		examples: ["alkalye doc comment list co_xyz --json"],
	},
	"doc comment add": {
		summary: "Add an inline comment.",
		usage:
			"alkalye doc comment add <doc-id> --body <body> (--quote <text>|--from <n> --to <n>)",
		options: [
			"--body <body>     Comment body",
			"--quote <text>    Quoted text to locate",
			"--from <n>        Zero-based start offset",
			"--to <n>          Zero-based end offset",
		],
		examples: [
			'alkalye doc comment add co_xyz --quote "text" --body "Please revise"',
			'alkalye doc comment add co_xyz --from 12 --to 40 --body "Question"',
		],
	},
	"doc comment reply": {
		summary: "Reply to a comment.",
		usage: "alkalye doc comment reply <doc-id> <comment-id> --body <body>",
		options: ["--body <body>   Reply body"],
	},
	"doc comment resolve": {
		summary: "Resolve a comment.",
		usage: "alkalye doc comment resolve <doc-id> <comment-id>",
	},
	"doc comment reopen": {
		summary: "Reopen a resolved comment.",
		usage: "alkalye doc comment reopen <doc-id> <comment-id>",
	},
	"doc comment delete": {
		summary: "Delete a comment.",
		usage: "alkalye doc comment delete <doc-id> <comment-id>",
	},
	"doc comment enable": {
		summary: "Enable comments.",
		usage: "alkalye doc comment enable <doc-id>",
	},
	"doc comment disable": {
		summary: "Disable comments.",
		usage: "alkalye doc comment disable <doc-id>",
	},
	"doc share create": {
		summary: "Create an invite link for a document.",
		usage: "alkalye doc share create <doc-id> --role <role>",
		options: ["--role writer|reader   Collaborator role"],
		examples: ["alkalye doc share create co_xyz --role writer"],
	},
	"doc share revoke": {
		summary: "Revoke a document invite group.",
		usage: "alkalye doc share revoke <doc-id> --invite-group-id <id>",
		options: ["--invite-group-id <id>   Invite group to revoke"],
	},
	"doc share list": {
		summary: "List document collaborators.",
		usage: "alkalye doc share list <doc-id>",
	},
	"doc share role": {
		summary: "Change a collaborator's role.",
		usage:
			"alkalye doc share role <doc-id> --invite-group-id <id> --role <role>",
		options: [
			"--invite-group-id <id>   Invite group to update",
			"--role writer|reader     New role",
		],
	},
	"doc public enable": {
		summary: "Make a document publicly accessible.",
		usage: "alkalye doc public enable <doc-id>",
	},
	"doc public disable": {
		summary: "Make a document private.",
		usage: "alkalye doc public disable <doc-id>",
	},
	"doc public link": {
		summary: "Get the public link for a document.",
		usage: "alkalye doc public link <doc-id>",
	},

	// space
	"space list": {
		summary: "List spaces.",
		usage: "alkalye space list",
		examples: ["alkalye space list --json"],
	},
	"space get": {
		summary: "Show space metadata.",
		usage: "alkalye space get <space-id>",
	},
	"space members": {
		summary: "List space members.",
		usage: "alkalye space members <space-id>",
	},
	"space docs": {
		summary: "List documents in a space.",
		usage: "alkalye space docs <space-id>",
	},
	"space create": {
		summary: "Create a space.",
		usage: "alkalye space create --name <name>",
		options: ["--name <name>   Space name"],
		examples: ['alkalye space create --name "Team Docs"'],
	},
	"space rename": {
		summary: "Rename a space.",
		usage: "alkalye space rename <space-id> --name <name>",
		options: ["--name <name>   New space name"],
	},
	"space delete": {
		summary: "Permanently delete a space.",
		usage: "alkalye space delete <space-id>",
	},
	"space leave": {
		summary: "Leave a shared space.",
		usage: "alkalye space leave <space-id>",
	},
	"space share create": {
		summary: "Create an invite link for a space.",
		usage: "alkalye space share create <space-id> --role <role>",
		options: ["--role writer|reader   Collaborator role"],
	},
	"space share revoke": {
		summary: "Revoke a space invite group.",
		usage: "alkalye space share revoke <space-id> --invite-group-id <id>",
		options: ["--invite-group-id <id>   Invite group to revoke"],
	},
	"space share list": {
		summary: "List space collaborators.",
		usage: "alkalye space share list <space-id>",
	},
	"space share role": {
		summary: "Change a space collaborator's role.",
		usage:
			"alkalye space share role <space-id> --invite-group-id <id> --role <role>",
		options: [
			"--invite-group-id <id>            Invite group to update",
			"--role admin|manager|writer|reader New role",
		],
	},
	"space public enable": {
		summary: "Make a space publicly accessible.",
		usage: "alkalye space public enable <space-id>",
	},
	"space public disable": {
		summary: "Make a space private.",
		usage: "alkalye space public disable <space-id>",
	},
	"space public link": {
		summary: "Get the public link for a space.",
		usage: "alkalye space public link <space-id>",
	},

	// invite
	"invite inspect": {
		summary: "Inspect an invite link without accepting.",
		usage: "alkalye invite inspect --link <url>",
		options: ["--link <url>   Invite link to inspect"],
	},
	"invite accept": {
		summary: "Accept an invite link.",
		usage: "alkalye invite accept --link <url> [--sync]",
		options: [
			"--link <url>   Invite link to accept",
			"--sync         Wait for remote sync",
		],
	},

	// sync
	"sync flush": {
		summary: "Wait for all local changes to sync.",
		usage: "alkalye sync flush",
	},
	"sync status": {
		summary: "Show sync and authentication status.",
		usage: "alkalye sync status",
	},
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

let rootCommands: [name: string, summary: string][] = [
	["auth", descriptions.auth],
	["account", descriptions.account],
	["doc", descriptions.doc],
	["theme", descriptions.theme],
	["space", descriptions.space],
	["invite", descriptions.invite],
	["sync", descriptions.sync],
]

function renderRootHelp(version: string) {
	let maxName = Math.max(...rootCommands.map(([name]) => name.length))
	return [
		`alkalye ${version}`,
		"",
		"Collaborate with alkalye.com from the CLI.",
		"Built for scripts and AI agents.",
		"",
		"Usage:",
		"  alkalye <command> [options]",
		"",
		"Commands:",
		...rootCommands.map(
			([name, summary]) => `  ${name.padEnd(maxName + 3)}${summary}`,
		),
		"",
		"Global options:",
		"  --json                Print machine-readable JSON",
		"  --quiet               Suppress output (exit code only)",
		"  --verbose             Include runtime context in output",
		"  --server <url>        Alkalye deployment URL",
		"  --sync-peer <url>     Override Jazz sync peer",
		"  --timeout <ms>        Sync timeout in milliseconds",
		"  --home <path>         CLI state directory",
		"  --version             Show version",
		"  -h, --help            Show help",
		"",
		"More help:",
		"  alkalye auth --help",
		"  alkalye doc --help",
		"  alkalye space --help",
	].join("\n")
}

function renderGroupHelp(path: string, def: GroupDef) {
	let lines = [
		`alkalye ${path}`,
		"",
		def.description,
		"",
		"Usage:",
		`  alkalye ${path} <command> [options]`,
	]
	for (let section of def.sections) {
		let maxName = Math.max(...section.items.map(([name]) => name.length))
		lines.push(
			"",
			`${section.heading}:`,
			...section.items.map(
				([name, summary]) => `  ${name.padEnd(maxName + 3)}${summary}`,
			),
		)
	}
	if (def.examples?.length) {
		lines.push("", "Examples:", ...def.examples.map(e => `  ${e}`))
	}
	return lines.join("\n")
}

function renderLeafHelp(path: string, def: LeafDef) {
	let lines = [
		`alkalye ${path}`,
		"",
		def.summary,
		"",
		"Usage:",
		`  ${def.usage}`,
	]
	if (def.options?.length) {
		lines.push("", "Options:", ...def.options.map(o => `  ${o}`))
	}
	if (def.examples?.length) {
		lines.push("", "Examples:", ...def.examples.map(e => `  ${e}`))
	}
	return lines.join("\n")
}
