import * as Hex from "effect/encoding/Hex"
import { decode } from "./base64"

export function isSigningPublicKey(publicKey: string) {
	if (!/^[\w-]{42}[AEIMQUYcgkosw048]$/.test(publicKey)) return false
	let point = decode(publicKey)
	point[31] = (point[31] ?? 0) & 0x7f
	let encoded = Hex.encode(point)
	let magnitude = Hex.encode(new Uint8Array([...point].reverse()))
	return magnitude < fieldPrime && !smallOrderPoints.has(encoded)
}
let fieldPrime =
	"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed"
// Web Crypto may accept torsion points. Values: libsodium's ge25519_has_small_order.
// https://github.com/jedisct1/libsodium/blob/1.0.18/src/libsodium/crypto_core/ed25519/ref10/ed25519_ref10.c
let smallOrderPoints = new Set([
	"0000000000000000000000000000000000000000000000000000000000000000",
	"0100000000000000000000000000000000000000000000000000000000000000",
	"26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
	"c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
	"ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
])
