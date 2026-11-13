import { cojsonInternals, RawGroup, RawCoMap, RawAccount } from "cojson"
import type { CryptoProvider } from "cojson"
import type { ClassicProof } from "./contract"
import { z } from "zod"
import { connectClassic } from "./transport"
export { verifyClassicProof, readClassicAccess }
let rawClassicId = z.templateLiteral(["co_z", z.string()])
let sharedConnection: ReturnType<typeof connectClassic> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
function verifyClassicProof(
	crypto: CryptoProvider,
	proof: ClassicProof,
	message: { nonce: string; accountId: string },
) {
	let header = {
		type: "comap",
		ruleset: { type: "group", initialAdmin: proof.agentId },
		meta: { type: "account" },
		createdAt: null,
		uniqueness: null,
	} satisfies Parameters<typeof cojsonInternals.idforHeader>[0]
	return (
		cojsonInternals.idforHeader(header, crypto) === proof.classicId &&
		crypto.verify(
			proof.signature,
			message,
			crypto.getAgentSignerID(proof.agentId),
		)
	)
}
async function readClassicAccess(classicId: string, accountId: string) {
	let connection = await classicVerifier()
	try {
		await connection.peer.waitUntilConnected()
		let value = (
			await connection.node.loadCoValueCore(rawClassicId.parse(classicId))
		).getCurrentContent()
		if (!(value instanceof RawCoMap))
			throw new Error("Classic item unavailable")
		let ruleset = value.core.verified.header.ruleset
		if (ruleset.type !== "ownedByGroup")
			throw new Error("Classic item has no owner group")
		let group = (
			await connection.node.loadCoValueCore(ruleset.group)
		).getCurrentContent()
		if (!(group instanceof RawGroup))
			throw new Error("Classic group unavailable")
		let account = [...group.getAllMemberKeysSet()].find(id => id === accountId)
		let role =
			group instanceof RawAccount && group.id === accountId
				? "admin"
				: account && cojsonInternals.isAccountID(account)
					? group.roleOf(account)
					: group.roleOf("everyone")
		if (!role || !["reader", "writer", "manager", "admin"].includes(role))
			throw new Error("Classic read access denied")
		let members: { id: string; role: string }[] = [
			...group.getAllMemberKeysSet(),
		].flatMap(id => {
			if (!cojsonInternals.isAccountID(id)) return []
			let role = group.roleOf(id)
			return role && ["reader", "writer", "manager", "admin"].includes(role)
				? [{ id, role }]
				: []
		})
		if (group instanceof RawAccount)
			members.push({ id: group.id, role: "admin" })
		let directMembers = group.getMemberKeys().flatMap(id => {
			if (!cojsonInternals.isAccountID(id)) return []
			let role = group.get(id)
			return role && ["reader", "writer", "manager", "admin"].includes(role)
				? [{ id, role }]
				: []
		})
		let originalOwner =
			group.core.verified.header.ruleset.type === "group"
				? group.core.verified.header.ruleset.initialAdmin
				: undefined
		let ownerClassicId =
			group instanceof RawAccount
				? group.id
				: (members.find(
						member => member.id === originalOwner && member.role === "admin",
					)?.id ?? members.find(member => member.role === "admin")?.id)
		let transactions = [...value.core.verified.getSessions()]
			.flatMap(([sessionId, log]) =>
				log.transactions.map(transaction => ({
					author: cojsonInternals.accountOrAgentIDfromSessionID(sessionId),
					madeAt: transaction.madeAt,
				})),
			)
			.sort((a, b) => a.madeAt - b.madeAt)
		let creator = transactions.find(transaction =>
			["admin", "manager", "writer", "writeOnly"].includes(
				group.atTime(transaction.madeAt).roleOfInternal(transaction.author) ??
					"",
			),
		)
		if (!creator) throw new Error("Classic value has no signed writer history")
		return {
			groupId: group.id,
			groupIds: ancestorGroups(group),
			createdBy: creator.author.startsWith("co_z") ? creator.author : undefined,
			ownerClassicId,
			role,
			publicRead: ["reader", "writer"].includes(group.roleOf("everyone") ?? ""),
			members,
			directMembers,
		}
	} catch (error) {
		connection.close()
		sharedConnection = undefined
		throw error
	}
}

function ancestorGroups(group: RawGroup, seen = new Set<string>()): string[] {
	if (seen.has(group.id)) return [...seen]
	seen.add(group.id)
	for (let parent of group.getParentGroups()) ancestorGroups(parent, seen)
	return [...seen]
}

function classicVerifier() {
	clearTimeout(closeTimer)
	let connection = (sharedConnection ??= connectClassic())
	closeTimer = setTimeout(() => {
		void connection.then(value => value.close())
		sharedConnection = undefined
	}, 30_000)
	return connection
}
