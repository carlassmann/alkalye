import { co, z } from "jazz-tools"

export { laserMessageSchema, LaserState, LaserHub, LaserSender }
export type { LaserMessage }

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
