# Integrated worker editor commands

Outside experiment; production unchanged. One actual native Editor, one Effect worker RPC authority, one real DocumentSession and one scoped FIFO combine reviewed Undo recovery with token-backed clipboard/menu commands. **72 assertions passed** on one final compiled bundle; types passed. Underlying copied source is recorded in `source-base.txt`; only shared CRDT was refreshed to production `2f55545`. This is not a current full-app parity or performance claim.

| Journey                                                  | Assertions |
| -------------------------------------------------------- | ---------: |
| Combined Cut / Undo / Redo / Paste / peer merge          |         11 |
| Original native Undo                                     |         11 |
| Transport faults, cached receipts, scope close           |         13 |
| Context menu Copy / Paste / Cut / Bold                   |         10 |
| Clipboard selection, denial, peer race, disposal         |         13 |
| Real adoption deadline and sticky late-candidate refusal |         14 |

Clipboard capability queries share the mutation FIFO. Frozen Undo refuses clipboard capture/resolve; cleanup remains permitted. Cut begins writing during the gesture, deletes only after successful write plus unchanged selection validation, and retains text on denial or peer change. Native changes carry tokens through the existing queue rather than creating another authority. Undo retains cached receipts, bounded transport retry, atomic publication and full recovery draft.

The adoption watchdog uses the existing scoped FiberSet, a Deferred and a real fifteen-second deadline. Both a held merge response and composition blocking adoption after a held Undo receipt reach sticky failure without dropping the full native draft. The strengthened journey directly exercises actual Editor late-adoption refusal, verifies one Undo request, and checks no candidate retries after failure. Deadline expiry never resends Undo. An interrupted/late response cannot re-enable editing; `setEditable(true)` cannot clear authority failure. Total candidate requests and stable-selection retries are bounded.

Final evidence is `*-certified.log`; `results.json` records source and compiled bundle hashes. Earlier successful runs used pre-watchdog sources and remain preliminary. Final Opus5.5 source review found no blocker; the fixture was strengthened before the certified run. Late-adoption refusal is proven directly through the actual Editor; completion of the interrupted merge queue cleanup is not independently asserted. A fixture-only optional selection typing error was corrected before the final build. The real deadline begins after the applied Undo receipt; a receipt that hangs indefinitely remains a separate gate. Late response handling and direct Editor guard checks are distinct assertions.

Peers are independent worker actors under one account. Clipboard APIs use controlled deferred promises; context menus are dispatched then clicked through background agent-browser. OS clipboard permissions and Safari activation are unverified. Task/comment/asset capabilities remain gated. Existing fixture disposal terminates the worker abruptly; it is not acknowledged durable Close. Main-tab crash/draft durability, production lifecycle integration and full application cutover remain unresolved. No frame-rate claim.

Preserved `.ts.txt` files are snapshots, excluded from production compilation. Reproduce in a disposable copy of the recorded source and dependencies, restore root filenames and the copied Editor/SourceTextarea/shared CRDT, adapt tsconfig base path, then `work run web`. Run the six journey scripts serially against the printed URL with background agent-browser and the stable 20000ms driver setting. Use actual source copies, never write through source symlinks. Stop the disposable server afterward.

written with gpt-6 in codex
