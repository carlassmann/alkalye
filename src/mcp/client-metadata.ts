import { Buffer } from "node:buffer"
import { lookup } from "node:dns"
import { get } from "node:https"
import { BlockList, isIP } from "node:net"
import type { LookupFunction } from "node:net"

export {
	fetchClientMetadata,
	isPublicAddress,
	configureCloudflareMetadataFetch,
}

let cloudflareFetch: typeof fetch | undefined

function configureCloudflareMetadataFetch(fetcher: typeof fetch | undefined) {
	cloudflareFetch = fetcher
}

async function fetchClientMetadata(url: URL): Promise<unknown> {
	let hostname = url.hostname.replace(/^\[|\]$/g, "")
	if (
		url.protocol !== "https:" ||
		(isIP(hostname) && !isPublicAddress(hostname))
	) {
		throw new Error("invalid_client")
	}
	if (cloudflareFetch) return fetchCloudflareMetadata(url, cloudflareFetch)
	return new Promise((resolve, reject) => {
		let request = get(
			url,
			{
				headers: { accept: "application/json" },
				lookup: lookupPublicAddress,
				agent: false,
				signal: AbortSignal.timeout(5_000),
			},
			response => {
				response.on("error", reject)
				if (response.statusCode !== 200) {
					response.destroy(new Error("invalid_client"))
					return
				}
				let body = ""
				response.setEncoding("utf8")
				response.on("data", chunk => {
					body += chunk
					if (Buffer.byteLength(body) > 64 * 1024) {
						response.destroy(new Error("invalid_client"))
					}
				})
				response.on("end", () => {
					try {
						let metadata: unknown = JSON.parse(body)
						resolve(metadata)
					} catch (error) {
						reject(error)
					}
				})
			},
		)
		request.on("error", reject)
	})
}

async function fetchCloudflareMetadata(url: URL, fetcher: typeof fetch) {
	// Workers' strictly-public fetch boundary replaces Node's pinned socket lookup.
	let response = await fetcher(url, {
		headers: { accept: "application/json" },
		redirect: "manual",
		signal: AbortSignal.timeout(5_000),
	})
	if (response.status !== 200 || !response.body) {
		await response.body?.cancel()
		throw new Error("invalid_client")
	}
	let reader = response.body.getReader()
	let decoder = new TextDecoder()
	let bytes = 0
	let body = ""
	try {
		while (true) {
			let { value, done } = await reader.read()
			if (done) break
			if (!value) throw new Error("invalid_client")
			bytes += value.byteLength
			if (bytes > 64 * 1024) throw new Error("invalid_client")
			body += decoder.decode(value, { stream: true })
		}
		body += decoder.decode()
		let metadata: unknown = JSON.parse(body)
		return metadata
	} finally {
		await reader.cancel().catch(() => undefined)
		reader.releaseLock()
	}
}

function isPublicAddress(address: string) {
	let family = isIP(address)
	if (family === 4) return !blockedAddresses.check(address, "ipv4")
	return (
		family === 6 &&
		globalIpv6.check(address, "ipv6") &&
		!blockedAddresses.check(address, "ipv6")
	)
}

let lookupPublicAddress: LookupFunction = (hostname, options, callback) => {
	// Validate the addresses used by the socket to prevent DNS rebinding.
	lookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) return callback(error, "")
		let first = addresses[0]
		if (!first || addresses.some(entry => !isPublicAddress(entry.address))) {
			return callback(new Error("invalid_client"), "")
		}
		callback(null, options.all ? addresses : first.address, first.family)
	})
}

let blockedAddresses = new BlockList()
for (let [address, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 3],
] satisfies [string, number][]) {
	blockedAddresses.addSubnet(address, prefix, "ipv4")
}
blockedAddresses.addSubnet("2001:db8::", 32, "ipv6")
let globalIpv6 = new BlockList()
globalIpv6.addSubnet("2000::", 3, "ipv6")
