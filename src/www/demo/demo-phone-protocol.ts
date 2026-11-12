import { z } from "zod"
import type { DemoCursor } from "./demo-script"

export { phoneMessage, stageMessageFor, parsePhoneMessage, parseStageMessage }
export type { DemoPhoneScreen, PhoneMessage }

// What the landing page shows on the phone.
type DemoPhoneScreen =
	| { kind: "editor"; content: string; cursors: DemoCursor[] }
	| { kind: "teleprompter"; content: string; presentationIndex: number }

let source = "alkalye-demo-phone"

let collaborator = z.object({
	name: z.string(),
	color: z.string(),
	device: z.enum(["phone", "laptop", "agent", "visitor"]),
})

let stageMessage = z.object({
	source: z.literal(source),
	locale: z.enum(["en", "de"]),
	screen: z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("editor"),
			content: z.string(),
			cursors: z.array(z.object({ collaborator, position: z.number() })),
		}),
		z.object({
			kind: z.literal("teleprompter"),
			content: z.string(),
			presentationIndex: z.number(),
		}),
	]),
})

// What the visitor does on the phone.
let phoneMessageSchema = z.object({
	source: z.literal(source),
	event: z.discriminatedUnion("type", [
		z.object({ type: z.literal("ready") }),
		z.object({ type: z.literal("typed"), content: z.string() }),
		z.object({ type: z.literal("index"), index: z.number() }),
		z.object({ type: z.literal("wheel"), deltaY: z.number() }),
	]),
})

type PhoneMessage = z.infer<typeof phoneMessageSchema>["event"]

function phoneMessage(event: PhoneMessage) {
	return { source, event }
}

function stageMessageFor(locale: "en" | "de", screen: DemoPhoneScreen) {
	return { source, locale, screen }
}

function parseStageMessage(data: unknown) {
	let parsed = stageMessage.safeParse(data)
	return parsed.success ? parsed.data : null
}

function parsePhoneMessage(data: unknown): PhoneMessage | null {
	let parsed = phoneMessageSchema.safeParse(data)
	return parsed.success ? parsed.data.event : null
}
