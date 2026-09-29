import { expect, test } from "vitest"
import {
	laserMessageSchema,
	packLaserMessage,
	unpackLaserMessage,
	type LaserMessage,
} from "./laser-schema"

test("packs full recovery windows with subpixel precision and preserves sample indices", () => {
	let samples = Array.from({ length: 128 }, (_, index) => ({
		index: index + 500,
		x: 0.5 + Math.cos(index) * 0.3,
		y: 0.5 + Math.sin(index) * 0.3,
	}))
	let message: LaserMessage = {
		type: "point",
		stroke: "s",
		target: "t",
		lease: "l",
		layout: "layout",
		slideNumber: 1,
		x: 0.5,
		y: 0.5,
		visible: false,
		samples,
	}
	let packed = laserMessageSchema.parse(packLaserMessage(message))
	let decoded = unpackLaserMessage(packed)
	if (decoded.type !== "point") throw new Error("Expected point")
	expect(decoded.visible).toBe(false)
	expect(decoded.samples).toHaveLength(128)
	for (let [index, original] of samples.entries()) {
		let restored = decoded.samples?.[index]
		if (!restored) throw new Error("Missing sample")
		expect(restored.index).toBe(original.index)
		expect(Math.abs(restored.x - original.x)).toBeLessThanOrEqual(0.00005)
		expect(Math.abs(restored.y - original.y)).toBeLessThanOrEqual(0.00005)
	}
	expect(JSON.stringify(packed).length).toBeLessThan(
		JSON.stringify(message).length * 0.35,
	)
	expect(unpackLaserMessage(message)).toEqual(message)
})
