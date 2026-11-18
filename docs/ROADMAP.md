# Roadmap and upstream work

## Gate 1: finish empirical acceptance

- Done: installed the reviewed extension in normal Chrome 157 with explicit human consent.
- Run the seven human tests, including sustained typing, clicking, other apps and Spaces.
- Done: verified a safe Google signed-in avatar without exporting session material.
- Add cross-origin iframe, drag/drop, native select, shadow DOM, slow loading,
  redirects, unsaved beforeunload and popup regressions.
- Exercise all allowed keys across page/iframe focus boundaries. Tab remains blocked.

## Gate 2: browser-owned non-activating surfaces

A page input target is insufficient when navigation or focus traversal reaches browser
UI. The smallest general architectural change is a Chrome-enforced non-activating
lane target with inherited popup ownership and offscreen modal rendering. It must
route all browser-created surfaces through the lane and preserve compositor liveness
under occlusion/Spaces. Reuse the normal profile's storage partition without
introducing a second process writing that profile. Public extension access to this
capability would remove the need for private virtual displays and app-focus repair.

Prototype Chromium changes around RenderWidgetHost focus traversal, WebContentsDelegate
activation and browser dialog/window creation, then propose upstream tests asserting
that a lane never activates an NSWindow. This is a proposal, not an implemented patch
or a proven sufficient change for every native authentication sheet.

## Gate 3: production ownership/recovery

- Browser-enforced capability handles rather than extension-only tab checks.
- Per-profile socket discovery and cryptographic client pairing if required beyond
  the trusted-local-user boundary; no reusable pairing secrets in agent config.
- Supervised worker recovery with browser-process generation identity; preserve
  human-reclaimed tabs and cancel queued disconnected clients.
- User-visible session list, revoke button, safe idle limits and scrubbed diagnostics.
- Strict per-lane navigation/network policy with explicit redirect/auth exceptions.
- Event-backed compositor health and frame/document generation IDs.

## Gate 4: adoption

- Compare recent signed Playwright MCP background work against this acceptance suite.
  Prefer an upstream supported implementation over maintaining a needless fork.
- Package the visual-only protocol as a backend for other MCP agents and test their
  image/coordinate support. Add Linux, Windows named-pipe ACLs and browser-specific
  native-host installers.
- Done: version 0.1.1 is available through the Chrome Web Store; the public listing
  and store-installed bridge workflow were verified on 2026-11-18. See [setup](STORE-SETUP.md).
- Maintain reproducible release packages, dependency updates and security review.
  Future store versions need a new versioned package and review; retain submission evidence.

No timeline or general zero-interruption claim is implied by this roadmap.
