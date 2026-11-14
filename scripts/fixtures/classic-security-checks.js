/* global fetch, AbortController */
// eslint-disable-next-line no-unused-vars -- Evaluated by the cutover runner.
async function verifyClassicSecurity(mode, fixture) {
	let { readClassicCredentials, deviceSecretFromSeed } =
		await import("/src/app/features/classic-import/identity.ts")
	let { openClassicAccount } =
		await import("/src/app/features/classic-import/reader.ts")
	let { deviceAuthorization } =
		await import("/src/app/features/agents/lib/agent-api.ts")
	let { stableId } =
		await import("/src/app/features/classic-import/conversion.ts")
	let credentials = readClassicCredentials()
	let key = deviceSecretFromSeed(new Uint8Array(credentials.secretSeed))
	let headers = {
		"content-type": "application/json",
		...deviceAuthorization(key),
	}
	if (mode === "reader") {
		let source = await openClassicAccount(
			new Uint8Array(credentials.secretSeed),
		)
		try {
			let challenge = await fetch("/api/classic-import?action=challenge", {
				method: "POST",
				headers,
			}).then(response => response.json())
			let claim = await fetch("/api/classic-import?action=claim", {
				method: "POST",
				headers,
				body: JSON.stringify({
					challengeId: challenge.challengeId,
					classicId: source.account.$jazz.id,
					agentId: source.crypto.getAgentID(source.secret),
					signature: source.crypto.sign(
						source.crypto.getAgentSignerSecret(source.secret),
						{ nonce: challenge.nonce, accountId: challenge.accountId },
					),
				}),
			})
			if (!claim.ok) throw new Error("Reader identity claim failed")
			let statuses = []
			for (let classicId of [
				fixture.unmigratedDocId,
				fixture.unmigratedPublicId,
			]) {
				let item = {
					kind: "document",
					classicId,
					content: "FORGED READER CONTENT",
					title: "Forged",
					tags: [],
					pinned: false,
					archived: false,
					isPresentation: false,
					commentsDisabled: false,
					createdAt: new Date(),
					updatedAt: new Date(),
					deletedAt: new Date(),
					versions: [
						{
							classicId: "forged",
							authorId: fixture.accountId,
							authorName: "Victim",
							content: "forged history",
							createdAt: new Date(),
						},
					],
					comments: [],
					assets: [],
				}
				let response = await fetch("/api/classic-import?action=item", {
					method: "POST",
					headers,
					body: JSON.stringify({ challengeId: challenge.challengeId, item }),
				})
				let body = await response.json()
				if (
					response.status !== 400 ||
					!body.error?.includes("Waiting for a Classic owner or editor")
				)
					throw new Error(
						`Reader forgery response ${response.status}: ${JSON.stringify(body)}`,
					)
				statuses.push(response.status)
			}
			return { readerForgery: statuses }
		} finally {
			source.close()
		}
	}
	if (mode === "leave") {
		let response = await fetch("/api/sharing/leave", {
			method: "POST",
			headers,
			body: JSON.stringify({ documentId: await stableId(fixture.docId) }),
		})
		if (!response.ok) throw new Error("Could not revoke v2 reader grant")
		return true
	}
	if (mode === "remove-classic") {
		let schema =
			await import("/src/app/features/classic-import/classic-schema.ts")
		let source = await openClassicAccount(
			new Uint8Array(credentials.secretSeed),
		)
		try {
			let doc = await schema.Document.load(fixture.docId, {
				loadAs: source.account,
			})
			if (!doc.$isLoaded) throw new Error("Classic document unavailable")
			let member = await schema.UserAccount.load(fixture.b, {
				loadAs: source.account,
			})
			if (!member.$isLoaded) throw new Error("Classic reader unavailable")
			doc.$jazz.owner.removeMember(member)
			let space = await schema.Space.load(fixture.spaceId, {
				loadAs: source.account,
			})
			if (!space.$isLoaded) throw new Error("Classic space unavailable")
			space.$jazz.owner.removeMember(member)
			await source.account.$jazz.waitForAllCoValuesSync({ timeout: 60000 })
			return true
		} finally {
			source.close()
		}
	}
	if (mode === "lookup") {
		let response = await fetch("/api/classic-import?action=lookup", {
			method: "POST",
			headers,
			body: JSON.stringify({
				classicId:
					fixture.lookupKind === "space" ? fixture.spaceId : fixture.docId,
				kind: fixture.lookupKind ?? "document",
			}),
		})
		return response.json()
	}
	let { runClassicImport } =
		await import("/src/app/features/classic-import/client.ts")
	let progress
	await runClassicImport(
		key,
		state => {
			if (state.done) progress = state
		},
		new AbortController().signal,
	)
	return progress
}
