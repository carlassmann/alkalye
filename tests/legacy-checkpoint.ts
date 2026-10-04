import {
	sealCheckpoint as encrypt,
	openCheckpoint as decrypt,
} from "../src/shared/checkpoint"
import type { ReplicaCheckpoint } from "../src/shared/checkpoint"
import type { Packet } from "../src/shared/model"
import { open, seal } from "./legacy-crypto"
export { parseCheckpoint, decodeCheckpoint } from "../src/shared/checkpoint"
export type {
	ReplicaCheckpoint,
	StoredCheckpoint,
	TargetCheckpoint,
} from "../src/shared/checkpoint"
export function sealCheckpoint(
	key: string,
	id: string,
	snapshot: ReplicaCheckpoint,
	room: string,
) {
	return encrypt(key, id, snapshot, room, { seal })
}
export function openCheckpoint(key: string, packet: Packet, room: string) {
	return decrypt(key, packet, room, { open })
}
