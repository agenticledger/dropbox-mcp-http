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
- [ ] GitHub commit/push
- [ ] Railway identity configured before deployment; live health/MCP proof
- [ ] Domain — no Namecheap changes without separate authorization
- [ ] MCPLive registry/docs/ZIP build, commit/push
- [ ] Portable AgentHub bundle; distinguish mirror from remote publication receipt
- [ ] Platform registry/catalog handoff
- [ ] Real Dropbox qualification — needs OAuth app and human consent

Writes default off. User-account tokens only; team impersonation not implemented or claimed.
