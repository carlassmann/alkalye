# Coalesce cursor updates in polling batches

A real slow-polling reader received 24 accepted cursor states. Keeping the newest state for each actor and document within each contiguous presence run reduced delivery to eight. Every control message separates runs, preserving departure and document-change order. Recipient and retained sender permissions, sessions and expiry remain freshly checked after dequeue.

The measured poll used 25 versus nine session statements and 58 versus 26 role statements. This is reduced database work, not a latency claim. The change does not prevent queue overflow and does not affect WebSockets.

Both diagnostic arms passed 39 public assertions. The clean candidate passed 28 transport and permission cases with 1,683 assertions, including queued revocation and presenter demotion. Exact Opus 5.5 review found no blocker. Producer files retain their original bytes; `archive-paths.json` maps the producer manifest to inert archived files. Initial fixture failure is retained.

Root full check passed 752 tests with 41,767 assertions, static checks and browser module journeys. Additional browser polling and network fallback journeys passed.

written with gpt-6 in codex
