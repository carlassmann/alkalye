import { co, z } from "jazz-tools"

export {
	laserMessageSchema,
	packLaserMessage,
	unpackLaserMessage,
	laserSampleLimit,
	LaserState,
	LaserHub,
	LaserSender,
}
export type { LaserMessage }

let laserSampleLimit = 128
let coordinateScale = 10_000

let laserMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("display"),
		lease: z.string(),
		requests: z.array(z.string()).max(16),
		id: z.string(),
		width: z.number().positive(),
		height: z.number().positive(),
		appearance: z.enum(["light", "dark"]),
		slideNumber: z.number(),
	}),
	z.object({
		type: z.literal("point"),
		stroke: z.string().optional(),
		packedSamples: z
			.array(
				z.tuple([
					z.number().int().nonnegative(),
					z.number().int().min(0).max(coordinateScale),
					z.number().int().min(0).max(coordinateScale),
				]),
			)
			.max(laserSampleLimit)
			.optional(),
		samples: z
			.array(
				z.object({
					index: z.number().int().nonnegative(),
					x: z.number().min(0).max(1),
					y: z.number().min(0).max(1),
				}),
			)
			.max(laserSampleLimit)
			.optional(),
		target: z.string(),
		lease: z.string(),
		layout: z.string(),
		slideNumber: z.number(),
		x: z.number().min(0).max(1),
		y: z.number().min(0).max(1),
		visible: z.boolean(),
	}),
	z.object({ type: z.literal("discover"), request: z.string() }),
	z.object({ type: z.literal("closed"), id: z.string() }),
])
type LaserMessage = z.infer<typeof laserMessageSchema>

let LaserSender = co.map({
	value: z.object({
		docId: z.string(),
		sequence: z.number(),
		sentAt: z.number(),
		message: laserMessageSchema,
	}),
})
let LaserState = co.record(z.string(), LaserSender)
let LaserHub = co.map({ current: LaserState })

function packLaserMessage(message: LaserMessage): LaserMessage {
	if (message.type !== "point" || !message.samples) return message
	let { samples, ...point } = message
	return {
		...point,
		x: Math.round(point.x * coordinateScale) / coordinateScale,
		y: Math.round(point.y * coordinateScale) / coordinateScale,
		packedSamples: samples.map(sample => [
			sample.index,
			Math.round(sample.x * coordinateScale),
			Math.round(sample.y * coordinateScale),
		]),
	}
}

function unpackLaserMessage(message: LaserMessage): LaserMessage {
	if (message.type !== "point" || !message.packedSamples) return message
	let { packedSamples, ...point } = message
	return {
		...point,
		samples: packedSamples.map(([index, x, y]) => ({
			index,
			x: x / coordinateScale,
			y: y / coordinateScale,
		})),
	}
}
