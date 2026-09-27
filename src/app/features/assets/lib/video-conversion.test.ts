import { afterEach, describe, expect, it, vi } from "vitest"

import { canEncodeVideo, compressVideo } from "./video-conversion"

afterEach(() => {
	vi.unstubAllGlobals()
	vi.resetModules()
})

describe("video encoding capabilities", () => {
	it("returns false without WebCodecs", async () => {
		vi.stubGlobal("VideoEncoder", undefined)
		vi.stubGlobal("AudioEncoder", undefined)
		expect(await canEncodeVideo()).toBe(false)
	})

	it("shares the codec probes across concurrent callers", async () => {
		let video = vi.fn().mockResolvedValue({ supported: true })
		let audio = vi.fn().mockResolvedValue({ supported: true })
		vi.stubGlobal("VideoEncoder", { isConfigSupported: video })
		vi.stubGlobal("AudioEncoder", { isConfigSupported: audio })
		let { canEncodeVideo } = await import("./video-conversion")
		expect(await Promise.all([canEncodeVideo(), canEncodeVideo()])).toEqual([
			true,
			true,
		])
		expect(video).toHaveBeenCalledTimes(1)
		expect(audio).toHaveBeenCalledTimes(1)
		expect(video.mock.calls[0]?.[0].codec).toBe("avc1.640028")
		expect(audio.mock.calls[0]?.[0].codec).toBe("mp4a.40.2")
	})

	it("handles rejected probes and retries on the next request", async () => {
		let video = vi
			.fn()
			.mockRejectedValueOnce(new Error("unavailable"))
			.mockResolvedValue({ supported: true })
		vi.stubGlobal("VideoEncoder", { isConfigSupported: video })
		vi.stubGlobal("AudioEncoder", {
			isConfigSupported: vi.fn().mockResolvedValue({ supported: true }),
		})
		let { canEncodeVideo } = await import("./video-conversion")
		expect(await canEncodeVideo()).toBe(false)
		expect(await canEncodeVideo()).toBe(true)
	})

	it("rejects Firefox support claims when an encoder cannot be created", async () => {
		vi.stubGlobal("navigator", { userAgent: "Firefox/143.0" })
		class UnavailableEncoder {
			static isConfigSupported = vi.fn().mockResolvedValue({ supported: true })
			constructor() {
				throw new Error("Encoder unavailable")
			}
		}
		vi.stubGlobal("VideoEncoder", UnavailableEncoder)
		vi.stubGlobal("AudioEncoder", {
			isConfigSupported: vi.fn().mockResolvedValue({ supported: true }),
		})
		let { canEncodeVideo } = await import("./video-conversion")
		expect(await canEncodeVideo()).toBe(false)
	})

	it("rejects invalid input before loading the converter", async () => {
		await expect(
			compressVideo(new File(["text"], "notes.txt", { type: "text/plain" })),
		).rejects.toMatchObject({ code: "invalid_format" })
	})
})
