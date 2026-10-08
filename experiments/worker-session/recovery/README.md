# Worker interruption and termination — correctness slice

written with gpt-6 in codex

Outside recovery arm of the 57-assertion handoff proof. No production changes. Latest outside source passed types/build and 66 real-browser assertions.

The fixture interrupts an actual ReplaceQueued RPC caller after native postMessage observation proves the RPC request posted. Worker Read must reconcile the same epoch to either unchanged sequence/source or exactly one applied edit. This deliberately permits cancellation before application and application before an ambiguous acknowledgement; it does not claim the test forces the applied outcome.

Then eight commands pass through the real main FIFO adapter. A fixture-only wrapper observes native postMessage without changing RPC contents. The worker protocol/platform owning Effect Scope closes before the RPC client scope, without a Close RPC; the existing WorkerPlatform finalizer calls native Worker.terminate, so worker DocumentSession finalizers do not run. The adapter scope then settles unfinished Deferreds while retaining its entire optimistic source and failed suffix. No unknown command is retried.

A new worker opens the same actual IndexedDB journal. Its source must equal one exact submitted prefix and include the previously acknowledged durable foundation. Locally applied but unsaved worker operations can be lost by abrupt termination; the submitted-prefix assertion does not claim every main edit was durable. The original main adapter retains all eight edits for explicit recovery/copy, including any withheld or lost suffix. Sync only accepts recovered durable journal actions, never blindly resubmits main intents.

Main tab/process reload durability for that retained optimistic draft is unproved. The fixture does not provide an application recovery UI, production worker lifecycle, actual EditorElement input proof or latency claim. No post-crash canonical overwrite is performed; preserved text remains available for an explicit recovery action.

Fixture-only POST /__tests/seed provisions source server-side through normal authenticated native APIs; no Replica is needed for this fixture's main-thread setup. The wider retained journey still uses Replica in its prior test provisioning and independent actor oracle, so its bundle is not a no-main-Replica app claim.

Observed run: interrupted RPC was once applied (sequence1), then reconciled. Abrupt termination had one posted request, one unknown delivery and seven blocked suffixes; restarted durable prefix was0. Whether that posted action had been locally applied before termination was not observed. A first run incorrectly treated global snapshot position as a per-document action count; preserved as fixture failure. The corrected final gate reads actual document history.
