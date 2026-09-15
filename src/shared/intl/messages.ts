import { merge, check } from "@ccssmnn/intl"

import { baseCommonMessages, deCommonMessages } from "./messages.common"
import { baseAuthMessages, deAuthMessages } from "./messages.auth"
import {
	baseDocumentsMessages,
	deDocumentsMessages,
} from "./messages.documents"
import { baseEditorMessages, deEditorMessages } from "./messages.editor"
import { baseSharingMessages, deSharingMessages } from "./messages.sharing"
import { baseSpacesMessages, deSpacesMessages } from "./messages.spaces"
import {
	baseImportExportMessages,
	deImportExportMessages,
} from "./messages.import-export"
import { baseSettingsMessages, deSettingsMessages } from "./messages.settings"
import {
	basePresentationMessages,
	dePresentationMessages,
} from "./messages.presentation"
import {
	baseOnboardingMessages,
	deOnboardingMessages,
} from "./messages.onboarding"

export { messagesEn, messagesDe }

let enHalf1 = merge(
	baseCommonMessages,
	baseAuthMessages,
	baseDocumentsMessages,
	baseEditorMessages,
	baseSharingMessages,
)
let enHalf2 = merge(
	baseSpacesMessages,
	baseImportExportMessages,
	baseSettingsMessages,
	basePresentationMessages,
	baseOnboardingMessages,
)
// @ts-expect-error PairwiseDisjoint exceeds TS inference limits at this key count
let messagesEn = merge(enHalf1, enHalf2)

let messagesDe = check(
	messagesEn,
	deCommonMessages,
	deAuthMessages,
	deDocumentsMessages,
	deEditorMessages,
	deSharingMessages,
	deSpacesMessages,
	deImportExportMessages,
	deSettingsMessages,
	dePresentationMessages,
	deOnboardingMessages,
)
