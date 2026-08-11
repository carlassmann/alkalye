import { z } from "zod"

export { makeProfileNameSchema }

interface ProfileNameMessages {
	required: string
	tooLong: string
}

function makeProfileNameSchema(messages: ProfileNameMessages) {
	return z.string().trim().min(1, messages.required).max(50, messages.tooLong)
}
