# Dropbox full release — 2026-10-29

Plan: verify broker readiness; implement typed direct Dropbox API v2 client and bounded tools;
verify mocked stdio and HTTP contracts; independent security review; publish standalone repository,
MCPLive docs/ZIP and portable AgentHub mirror; deploy only after broker prerequisite; hand off registry.

- [x] Full release skill invoked; workspace and broker contracts read
- [x] Official OAuth, SDK/API, errors and team files docs rechecked
- [x] Broker provider live — independently verified in production; local documentation stale. Offline, refresh, app credential presence and consent URL proven. Unused file_requests scopes remain a broker-owner least-privilege follow-up.
- [x] Canonical stdio + standalone HTTP
- [x] 30 mocked unit/contract tests; format/lint/typecheck/build passed; production audit zero vulnerabilities
- [x] Independent review approved; all concrete findings resolved, regression tests added
- [x] README, setup, searchable interactive tool docs, official research and review evidence
- [x] GitHub public repository created and main pushed; initial code commit 63ce840f1a4b3f82b6569e3100aa910c77b20945
- [x] Railway identity configured before first deployment; initial deployment 2c4cf419-7b9a-4ae5-842c-c8e444161bed SUCCESS; live health 200, initialize, 33 tools and principal-only connection_required with Dropbox consent link
- [ ] Domain BLOCKED on owner DNS: Railway custom hostname registered; CNAME dropboxmcp → l0eorumv.up.railway.app; TXT \_railway-verify.dropboxmcp required. No Namecheap changes. Verified Railway fallback is published.
- [x] MCPLive registry/docs/ZIP built and pushed f9c08ba; public docs/schema/ZIP HTTP 200. Isolated worktree preserves unrelated ZIP changes. Desktop/mobile screenshot and search/expand/empty-state checks passed.
- [x] Portable AgentHub manifest and downloadable source package. Finney Registry dropbox contribution submitted, PENDING admin review. No remote AgentHub publication API/receipt available; portable mirror only.
- [x] Ready-to-paste @hub handoff emitted with actual endpoint, broker namespace/auth and 33 tools; platform files not edited
- [ ] Real Dropbox qualification BLOCKED on human consent and app-console confirmation: app credential variables present and offline consent URL proven; actual user grant, refresh and provider operations not tested. Broker owner must narrow two unused file_requests scopes.

Writes default off. User-account tokens only; team impersonation not implemented or claimed.
