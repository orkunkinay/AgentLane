# Contributing

Start with README, SECURITY.md and docs/EVIDENCE.md. This is an experimental public-API
reference implementation. Preserve the distinction between measured behavior and
hypotheses; never turn a partial test into a general no-interference claim.

Use Node 22.13 or newer, `npm ci`, `npm test` and `npm run format:check`. Source syntax
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

Local checks do not establish the result of GitHub-hosted CI. Inspect that workflow
separately; Linux/browser compatibility remains subject to its results.


## Extension development

Normal users install the [existing Chrome Web Store extension](https://chromewebstore.google.com/detail/agentlane/mpiigaljakpfmmihkahppdaaccmpgmmk)
and follow [store setup](docs/STORE-SETUP.md). For repository updates before store release, users may choose the
[manual installation route](docs/MANUAL-SETUP.md), which requires Developer mode. The store download contains the extension; the local
native bridge and MCP server remain separate prerequisites.

For an unpacked development build, use a disposable Chrome profile and synthetic data:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the checkout's `extension/` folder.
3. Copy that development card's own ID. It differs from the store ID.
4. Register only that exact development ID with the test profile's native bridge.
   Use the disposable-profile harnesses rather than overwriting a personal store
   registration. A code/test task does not authorize changing the installed extension.

![Developer-only unpacked extension setup in a disposable Chrome profile.](docs/images/chrome-extensions.png)

After an extension source edit, finish test sessions, reload the unpacked extension
and create a fresh lane. Restart the test MCP process after MCP source changes.
The store-installed extension does not load source changes from the checkout.

Keep the store installation recommended and manual installation explicitly optional.
Explain its own extension ID and manual update lifecycle. Retain dated experiment
and submission evidence with its original context.

## Coordination changes and release checks

Read [the coordination contract](docs/COORDINATION.md) and
[the architectural decision](docs/decisions/001-coordination.md) before changing
identity, scheduling, retry or handoff behavior. The broker uses built-in SQLite;
Node.js 22.13+ is the minimum. No database server or new npm dependency is required.

```sh
npm test
npm run format:check
npm run check:site
npm run package:extension
node experiments/setup.mjs
node experiments/dropdown.mjs
AGENTLANE_MCP=1 AGENTLANE_NAVIGATION_PROBE=1 npm run test:browser
npm run test:reliability
npm run test:recovery
```

JavaScript syntax checks, JSON validation and runtime regression tests are provided;
a whole-project static typecheck is not yet configured. CI includes Linux/Node 24
and macOS/Node 22.13 jobs, but configured jobs are not evidence of a completed hosted
run. All browser fixtures are disposable. Temporary test workload/resource sampling
is not production health monitoring. Do not enable recurring diagnostics.

Retain a failed benchmark trial and its configuration. Renderer-controlled human
surrogates do not establish physical keyboard/pointer isolation. Comparative results
need matched configurations and repeated/counterbalanced trials; do not infer a
competitor failure from design documentation or an unavailable baseline.
