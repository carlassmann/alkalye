# Interrupt background snapshot capture on input

Candidate held outside production. Reconstruct from `754c9d6` and `candidate.patch.txt`; root reconstruction matches both candidate modules. Effect PubSub subscriptions and scoped `raceFirst` cancel only automatic capture. Persistence and forced snapshots remain outside that race. Graceful PubSub end preserves parent interruption.

Six real SQLite integration cases passed 101 assertions: quiet retry, owner closure, simultaneous parent cancellation, failure retention/retry, input during persistence, and cooperative capture outcome. The initial metadata oracle used a register instead of frontmatter-derived metadata and failed; its log is retained. Corrected public metadata assertions passed. Initial diagnostic Scope typing failure is also retained.

A separate marked case traversed 8,192 actual atoms before public input. Latest witness (milliseconds from its phase start): active checkpoint 512.512; input 512.644; capture interrupted 513.071; permit returned 513.078; foreground edit durably saved 559.187; later quiet snapshot returned 1071.218. Twenty assertions proved old cache remained intact, subsequent exact cache/accepted/cold source and Undo/Redo, plus permit-release ordering. This is a correctness diagnostic, not browser input-to-paint or comparative performance evidence.

`active-markers.patch.txt` adds only diagnostic marks. The marked test source is archived separately from the proposed six-case production test. The stripped production test has not yet been retyped or rerun. No frame-rate gain or production adoption is claimed. Native paced-input comparison remains required.

`mapping.json.txt` preserves producer bytes and SHA256. Preparation records describe their original time, not the latest execution state. Private databases, browser profiles, real account keys and bulk traces are excluded.
