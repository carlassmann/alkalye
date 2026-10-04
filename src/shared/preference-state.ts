import * as Schema from "effect/Schema"
import {
	AccountPreferencesSchema,
	PreferencePatchSchema,
	accountPreferences,
	preferenceChanges,
	preferencesFromFields,
} from "./preferences"
import type { AccountPreferences } from "./preferences"

export let PreferenceIntentSchema = Schema.Struct({
	request: Schema.NonEmptyString,
	patch: PreferencePatchSchema,
})
let rejectedSchema = Schema.Struct({
	value: Schema.Unknown,
	message: Schema.String,
})
let recordSchema = Schema.Record(Schema.String, Schema.Unknown)
export interface PreferenceState {
	accepted: AccountPreferences
	pending: ReadonlyArray<unknown>
	rejected: ReadonlyArray<typeof rejectedSchema.Type>
}
export function readPreferenceState(value: unknown): PreferenceState {
	let source = Schema.decodeUnknownResult(recordSchema)(value)
	if (source._tag === "Failure")
		return {
			accepted: accountPreferences(undefined),
			pending: [],
			rejected:
				value === undefined
					? []
					: [{ value, message: "Unrecognized saved preferences" }],
		}
	let raw = source.success
	let rejected = rows(raw.rejected).map(value => {
		let parsed = Schema.decodeUnknownResult(rejectedSchema)(value)
		return parsed._tag === "Success"
			? parsed.success
			: { value, message: "Unrecognized recovery entry" }
	})
	let acceptedRecord = Schema.decodeUnknownResult(recordSchema)(raw.accepted)
	let accepted = accountPreferences(
		acceptedRecord._tag === "Success" ? acceptedRecord.success : undefined,
	)
	let valid = Schema.decodeUnknownResult(AccountPreferencesSchema)(accepted)
	if (valid._tag === "Failure") {
		rejected.push({
			value: raw.accepted,
			message: "Invalid saved preference snapshot",
		})
		accepted = accountPreferences(undefined)
	}
	return { accepted, pending: rows(raw.pending), rejected }
}
export function preferenceIntents(state: PreferenceState) {
	return state.pending.flatMap(value => {
		let parsed = decodeIntent(value)
		return parsed._tag === "Success" ? [parsed.success] : []
	})
}
export function preferenceRecovery(state: PreferenceState) {
	return [
		...state.rejected,
		...state.pending.flatMap(value =>
			decodeIntent(value)._tag === "Failure"
				? [
						{
							value,
							message: "This app version cannot read a saved preference change",
						},
					]
				: [],
		),
	]
}
export function preferenceValue(state: PreferenceState) {
	return preferenceIntents(state).reduce(
		(value, intent) =>
			preferencesFromFields(preferenceChanges(intent.patch), value),
		state.accepted,
	)
}
export function acknowledgePreference(
	state: PreferenceState,
	intent: typeof PreferenceIntentSchema.Type,
) {
	if (
		!preferenceIntents(state).some(
			pending => pending.request === intent.request,
		)
	)
		return state
	return {
		...state,
		accepted: preferencesFromFields(
			preferenceChanges(intent.patch),
			state.accepted,
		),
		pending: removeIntent(state.pending, intent.request),
	}
}
export function rejectPreference(
	state: PreferenceState,
	intent: typeof PreferenceIntentSchema.Type,
	message: string,
) {
	if (
		!preferenceIntents(state).some(
			pending => pending.request === intent.request,
		)
	)
		return state
	return {
		...state,
		pending: removeIntent(state.pending, intent.request),
		rejected: [...state.rejected, { value: intent, message }],
	}
}
function decodeIntent(value: unknown) {
	return Schema.decodeUnknownResult(PreferenceIntentSchema, {
		onExcessProperty: "error",
	})(value)
}
function removeIntent(pending: ReadonlyArray<unknown>, request: string) {
	return pending.filter(value => {
		let decoded = decodeIntent(value)
		return decoded._tag === "Failure" || decoded.success.request !== request
	})
}
function rows(value: unknown): unknown[] {
	return value === undefined ? [] : Array.isArray(value) ? value : [value]
}
