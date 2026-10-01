export { readJsonResponse }

async function readJsonResponse(response: Response): Promise<unknown> {
	let body = await response.text()
	if (!body) return undefined

	try {
		let value: unknown = JSON.parse(body)
		return value
	} catch {
		return undefined
	}
}
