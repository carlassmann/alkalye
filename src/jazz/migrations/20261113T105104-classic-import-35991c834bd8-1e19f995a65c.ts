import { schema as s, migration as m } from "jazz-tools";

export default m.defineMigration({
  createTables: {
    "classicAccess": true,
    "classicAccounts": true,
    "classicChallenges": true,
    "classicImportChunks": true,
  },
  migrate: {
    "classicImports": {
      "baseContent": m.add.string({ default: null }),
      "classicOwnerId": m.add.string({ default: null }),
    },
  },
  fromHash: "35991c834bd8",
  toHash: "1e19f995a65c",
  from: {
  "classicImports": s.table({
    "ownerId": s.uuid(),
    "classicId": s.string(),
    "v2Id": s.uuid(),
    "kind": s.string(),
    "status": s.enum("pending", "complete", "failed"),
    "importedAt": s.timestamp().optional(),
    "error": s.string().optional(),
  }, {

  })
},
  to: {
  "classicAccess": s.table({
    "classicId": s.string(),
    "resourceId": s.uuid(),
    "kind": s.enum("document", "space"),
    "role": s.enum("reader", "writer", "manager", "admin"),
  }, {

  }),
  "classicAccounts": s.table({
    "ownerId": s.uuid(),
    "classicId": s.string(),
  }, {

  }),
  "classicChallenges": s.table({
    "ownerId": s.uuid(),
    "nonce": s.string(),
    "expiresAt": s.timestamp(),
    "classicId": s.string().optional(),
  }, {

  }),
  "classicImportChunks": s.table({
    "ownerId": s.uuid(),
    "uploadId": s.string(),
    "part": s.int(),
    "data": s.bytes(),
    "createdAt": s.timestamp(),
  }, {

  }),
  "classicImports": s.table({
    "ownerId": s.uuid(),
    "classicId": s.string(),
    "v2Id": s.uuid(),
    "kind": s.string(),
    "baseContent": s.string().optional(),
    "classicOwnerId": s.string().optional(),
    "status": s.enum("pending", "complete", "failed"),
    "importedAt": s.timestamp().optional(),
    "error": s.string().optional(),
  }, {

  })
},
});
