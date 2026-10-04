import { expect, test } from "bun:test"
import * as Schema from "effect/Schema"
import {
	acknowledgePreference,
	preferenceIntents,
	preferenceRecovery,
	preferenceValue,
	readPreferenceState,
	rejectPreference,
} from "../src/shared/preference-state"
import {
	PreferencePatchSchema,
	accountPreferences,
} from "../src/shared/preferences"

test("preference cache upgrades fill missing defaults while preserving undecodable intents", () => {
	let obsolete = {
		request: "old",
		patch: { editor: { futurePreference: true } },
	}
	let malformed = { request: "bad", patch: { fontSize: 100 } }
	let next = { request: "next", patch: { editor: { lineWidth: 90 } } }
	let saved = readPreferenceState({
		accepted: { name: "Old profile", editor: { smartPairs: false } },
		pending: [obsolete, malformed, next],
	})
	expect(saved.accepted.name).toBe("Old profile")
	expect(saved.accepted.editor.smartPairs).toBe(false)
	expect(saved.accepted.editor.smartPaste).toBe(true)
	expect(saved.pending).toEqual([obsolete, malformed, next])
	expect(preferenceIntents(saved)).toEqual([next])
	expect(saved.rejected).toEqual([])
	expect(preferenceRecovery(saved).map(item => item.value)).toEqual([
		obsolete,
		malformed,
	])
	expect(preferenceValue(saved).editor.lineWidth).toBe(90)
	expect(readPreferenceState(saved)).toEqual(saved)
})

test("older app versions never quarantine newer preference intents during unrelated writes", () => {
	let future = {
		request: "future",
		patch: { language: "fr", editor: { futureSetting: true } },
	}
	let unreadable = { request: "bad", patch: { fontSize: 99 } }
	let valid = { request: "valid", patch: { fontSize: 21 } }
	let refused = { request: "refused", patch: { name: "Name" } }
	let state = readPreferenceState({
		accepted: accountPreferences(undefined),
		pending: [future, unreadable, valid, refused],
	})
	state = acknowledgePreference(state, valid)
	state = rejectPreference(state, refused, "Server refused")
	state = readPreferenceState({
		...state,
		accepted: { ...state.accepted, fontSize: 22 },
		pending: [
			...state.pending,
			{ request: "new", patch: { appearance: "dark" } },
		],
	})
	expect(state.pending.slice(0, 2)).toEqual([future, unreadable])
	expect(state.rejected).toHaveLength(1)
	expect(preferenceIntents(state)).toEqual([
		{ request: "new", patch: { appearance: "dark" } },
	])
	expect(preferenceRecovery(state).map(item => item.value)).toEqual([
		refused,
		future,
		unreadable,
	])
})

test("rejecting and acknowledging exact intents preserve unrelated pending work and recovery entries", () => {
	let first = { request: "first", patch: { name: "Rejected name" } }
	let next = { request: "next", patch: { fontSize: 21 } }
	let late = { request: "late", patch: { editor: { smartPairs: false } } }
	let saved = readPreferenceState({
		accepted: accountPreferences(undefined),
		pending: [first, next, late],
	})
	let rejected = rejectPreference(saved, first, "Conflicting retry")
	let accepted = acknowledgePreference(rejected, next)
	expect(accepted.pending).toEqual([late])
	expect(accepted.rejected).toEqual([
		{ value: first, message: "Conflicting retry" },
	])
	expect(accepted.accepted.name).toBe("Anonymous writer")
	expect(accepted.accepted.fontSize).toBe(21)
	expect(preferenceValue(accepted).editor.smartPairs).toBe(false)
	expect(acknowledgePreference(accepted, next)).toEqual(accepted)
})

test("damaged preference envelopes remain recoverable instead of blocking a new valid intent", () => {
	let raw = "damaged settings"
	let saved = readPreferenceState(raw)
	expect(saved.rejected[0]?.value).toBe(raw)
	let edited = readPreferenceState({
		...saved,
		pending: [{ request: "new", patch: { fontSize: 24 } }],
	})
	expect(preferenceValue(edited).fontSize).toBe(24)
	expect(edited.rejected[0]?.value).toBe(raw)
	for (let patch of [{}, { editor: {} }])
		expect(Schema.decodeUnknownResult(PreferencePatchSchema)(patch)._tag).toBe(
			"Failure",
		)
})
