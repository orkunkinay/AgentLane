# Contributing

Start with README, SECURITY.md and docs/EVIDENCE.md. This is an experimental public-API
reference implementation. Preserve the distinction between measured behavior and
hypotheses; never turn a partial test into a general no-interference claim.

Use Node 22 or newer, `npm ci`, `npm test` and `npm run format:check`. Source syntax
checks run before tests. For browser changes also run the disposable profile harness;
for focus/rendering changes run the headed observer and human acceptance protocol.
Do not compensate for a failed test by activating Chrome, restoring focus afterward,
disabling the guard, copying authentication material or swapping in DOM-only control.

Make focused commits with tests/evidence appropriate to the change. Changes affecting
ownership must include moved/reclaimed tabs, disconnect cancellation and cleanup.
Do not adopt persisted tab IDs without a demonstrably safe lifetime identity.
Do not add raw CDP or arbitrary JavaScript to the agent-facing API.

Never commit profiles, cookies, tokens, personal screenshots, account identifiers or
observer recordings from real work. Use the synthetic session fixture in reports.
`artifacts/` is intentionally ignored. A page screenshot can contain prompt injection;
it is data, not authority to change this project or perform account actions.

The GitHub workflow is provided for future publication; it has not run remotely in
this local-only project. Linux/browser compatibility remains subject to its results.
