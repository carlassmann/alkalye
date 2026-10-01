import { describe, expect, test } from "vitest"
import { fetchClientMetadata, isPublicAddress } from "./client-metadata"

describe("client metadata network access", () => {
	test.each([
		"127.0.0.1",
		"10.1.2.3",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"224.0.0.1",
		"::1",
		"fc00::1",
		"fe80::1",
		"::ffff:127.0.0.1",
		"2001:db8::1",
	])("rejects non-public address %s", address => {
		expect(isPublicAddress(address)).toBe(false)
	})

	test.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
		"accepts public address %s",
		address => {
			expect(isPublicAddress(address)).toBe(true)
		},
	)

	test.each([
		"http://client.example/client.json",
		"https://127.0.0.1/client.json",
		"https://[::1]/client.json",
		"https://169.254.169.254/client.json",
		"https://localhost/client.json",
	])("blocks metadata request to %s", async url => {
		await expect(fetchClientMetadata(new URL(url))).rejects.toThrow(
			"invalid_client",
		)
	})
})
