# Chrome Web Store beta submission

Target: AgentLane 0.1.1, English, unlisted beta, Developer Tools category.
The listing must disclose macOS, Chrome 134+, Node.js 22+, the separately installed
native messaging host/MCP server, and an MCP-compatible client. AI provider costs
and data policies depend on the user's chosen client/provider.

## Prepared materials

- `npm run package:extension`: extension-only ZIP, SHA-256 and build-info.json in
  `artifacts/chrome-store/`. The script verifies an exact 15-file allowlist.
- `npm run assets:store`: three opaque 1280x800 screenshots, 440x280 promo tile and
  128px icon. Screenshots show disposable-profile UI and synthetic data, with setup
  prerequisites and experimental limitations visible in the artwork.
- `description.txt`: store description, including setup and privacy disclosures.
- `listing.json`: summary, URLs, single purpose and permission explanations.
- `reviewer-instructions.md`: reproducible local bridge/MCP installation and synthetic
  workflow with no real-account credentials or paid model calls required.
- Public privacy page: https://orkunkinay.github.io/AgentLane/privacy/
- The first-run checkbox is required before native bridge connection and acceptance
  is stored locally as accessConsentVersion=1. Old configurations also require it.

## Validation performed

- 37 unit/transport/migration/installer tests passed.
- Setup integration passed first-run disclosure enforcement and persistence,
  saved-site preservation, repeated lane creation and native-host restart with the
  same MCP process. It also passed against the extracted upload ZIP.
- Headless MCP/native/Chrome navigation-probe integration passed 30 rounds, preserving
  human fixture input/selected tab, iframe/history capture and selected/any URL policy.
- Native-select integration passed mouse/keyboard, dynamic controls, open shadow roots,
  cross-origin iframe, navigation/CSP and conflicting-style refusal checks.
- Site link/tool validation and source formatting passed. Mobile/desktop privacy and
  all store artwork were rendered and visually inspected.
- Repeated packaging produced the same archive hash. The ZIP contains no native host,
  node_modules, environment files, source checkout, test data or personal screenshots.
- This release does not claim a new full live mail journey, cross-platform verification,
  universal native-dialog/closed-shadow isolation, or a new clean physical-desktop run.

## Submission steps in the owner's account

1. Complete developer registration if required. Acceptance of Google's binding
   agreement needs action-time confirmation; payment requires an explicit fee limit.
2. Upload `agentlane-0.1.1.zip` as a new item and record its assigned extension ID.
3. Fill English store copy, category, official website, support and privacy URLs.
4. Upload store icon, screenshots and optional promo tile.
5. Enter single purpose and all three permission justifications. No remotely hosted
   extension logic is used; the fixed select bootstrap is bundled in the ZIP.
6. Declare screenshot/URL/input processing accurately. Website content, user activity,
   requested browsing URLs and sensitive information visible in those pixels/text are
   handled by the MCP pipeline. Do not claim no data handling just because the project
   operates no collection server. Reflect applicable dashboard categories, including
   personal communications, personal/authentication, financial, health or location
   data when present in user-directed pages. Certify limited use only consistently
   with the privacy page, source behavior and downstream client/provider explanation.
7. Choose Unlisted distribution. It is link-accessible, not private, and still undergoes
   the ordinary review requirements. Do not promise public-store discoverability.
8. Provide reviewer instructions and submit for review. Record the actual dashboard
   status and item URL; upload/draft creation alone is not a successful submission.
9. Update install links and native-host instructions with the real store extension ID.
   Existing unpacked IDs must not silently gain broadened native-host origins.

Policy references checked on 17 November 2026:

- https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/policies
- https://developer.chrome.com/docs/webstore/images

This checklist is preparation evidence. The developer dashboard's actual status is
required before claiming the extension was submitted, approved or published.
