# Production peer editing and offline recovery

Twelve untimed application gates passed on rewrite `514e1bb`, using independent browser profiles for the same account and an independent authenticated HTTP oracle. Both clients typed through native editor input, observed live convergence, and verified their accepted Undo results.

An offline edit survived a service-worker-controlled reload from IndexedDB. The server's accepted prefix stayed at position 33 while offline, advanced to 34 after reconnection, and Undo at position 35 restored the exact baseline. Browser contexts and the controlled server closed after success.

This establishes behavior in the tested two-profile journey. It is not a latency comparison, separate-account permission test, twenty-writer capacity result or physical frame-rate claim. The exact executed harness, strict/runtime logs, results and provenance are retained unchanged. Archive maps record bytes and SHA256. Credentials, databases and browser profiles are excluded.

written with gpt-6 in codex
