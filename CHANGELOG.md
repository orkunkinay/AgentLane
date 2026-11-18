# Changelog

## 0.2.0 — unreleased source

- Per-owner operation queues with a shared screenshot/tab-management mutex.
- Per-command ownership, cancellation and focus-generation fencing; tab moves revoke
  ownership immediately. Renderer failure fences its owner rather than every agent.
- Correlated transport replies, bounded client/request/adapter queues and MCP cancellation.
- Kernel-backed broker singleton locking and a bounded SQLite metadata journal. Unknown
  mutation outcomes are never replayed; duplicate IDs are refused within retention.
- Opt-in capability-file logical sessions survive MCP/native-host restarts while the
  extension retains the original capability. Concurrent leases and environment changes
  are rejected. Worker/Chrome registry loss fails closed; disk tab IDs are not adopted.
- Explicit human takeover/handback/release and session observation-only access in the
  extension popup, updated from lifecycle events rather than a polling timer.
- Disclosure version 2 for operation metadata; legacy extensions retain compatibility
  without new journal retention. Node.js 22.13+ is required for the local broker.
- Synthetic 1/2/5/10/20-client tests, server-side-effect acknowledgement-loss injection,
  expanded CI and security regressions. See docs/EVIDENCE.md for measured boundaries.

No 0.2.0 package has been submitted or published to the Chrome Web Store by this work.

## 0.1.1

Existing Chrome Web Store beta and the documented source/manual installation routes.
The original submission hash/status is retained in docs/store/submission-status.json.
