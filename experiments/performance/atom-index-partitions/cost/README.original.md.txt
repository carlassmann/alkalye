# Native atom-index partitions — public cost gate

Outside candidate only; production unchanged. Fixed256 native Map leaves. Fork snapshots leaf references and clears write ownership on BOTH parent/child; first write copies only touched leaf. Exact keys and frozen entries; existing Schema/visibility/receipt/permission/wire gates preserved. Atom partition is a deterministic internal lookup hint, never a trusted-ID flag. Arbitrary IDs use stable fallback. Children whole-map copy remains (~52ms previous native diagnostic); whole-fork O(1) not claimed.

Strict passed. 108 public tests/1483 assertions in7files passed: native/candidate sustained260edit and siblings/parent convergence; arbitraryUTF16 legacy-ID typedrestore/fork; public cold/hydration/interruption; realSQLite1/512 replacement UndoRedo/peer/header/comments/scope. Remote Opus actual patch read-only review found no correctness blocker; cold/hot/firstwrite gates required.

Original cost plan:66 samples, n3 per arm/mode. Terminal failure after55 rows:54 paired normal/sustained/clock-wrap cells passed; first baseline typedlegacy sync cell passed, then baseline fromCheckpointEffect rejected arbitraryIDs at existing TextAtomIdSchema BEFORE candidate. Do not call the original plan66PASS. Malformed IDs/Schema were not changed. Separate fresh supported typed-direct-sync legacy continuation:6 samples, n3/arm, all exact source/512insertion/both-wayfork independence PASS. Do not merge the extra original baseline sample into continuation n3.

| Long fixture median ms | Native Map | Partition |
| --- | ---: | ---: |
| Large apply | 905.834 | 913.181 |
| Sync restore | 733.152 | 678.544 |
| Sync cold text | 225.875 | 287.132 |
| Cooperative restore | 2097.075 | 2034.977 |
| Owned fork after sync restore | 193.573 | 94.153 |
| Owned fork after cooperative restore | 209.864 | 96.431 |
| 10,240 lookups after sync restore | 0.321 | 0.691 |
| First512 child write after sync fork | 0.768 | 0.999 |
| First512 parent write after sync fork | 0.767 | 0.848 |

Long fixture1,048,576 UTF16 units/1,198,368 UTF8 bytes; exactSHA150a08… in metadata. Sustained128KiB seed plus260small operations and20concurrent same-clock module writers; this is NOT20browser sessions. Clock-wrap uses10010actual edits, no forcedclock mutation. Their complete n3 metrics are retained, including sustainedapply65.988→72.201ms and wrapsync4.772→5.300ms regressions.

Supported legacy direct-sync medians: load6.259→8.549ms; lookup0.240→0.455; ownedfork1.152→0.694; firstchild512write1.175→0.928; firstparent512write1.496→0.912. Arbitrary-ID cooperative decoder path remains unsupported/unproved. Legacy collision fixture groups IDs but first newly generated canonical operation may address a different leaf; not proof every worst-case colliding write is cheap.

Fork, firstwrite, coldtext and lookup windows separate. Memory brackets are whole-process, GC/retainedfixture/allocator-confounded; no retained-object ownership claim. Native worker/app comparison UNRUN; no broad performance adoption/physical120Hz claim. Coldtext and hotlookups worsened; these limits require review alongside fork improvement.

written with gpt-6 in codex
