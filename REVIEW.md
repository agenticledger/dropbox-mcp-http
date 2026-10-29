# Independent release review — 2026-10-29

Reviewer: separate `dropbox_review` agent, read-only review of source and official Dropbox type definitions. Reviewer did not modify code or services.

Initial verdict: request changes. Findings resolved:

- HMAC non-ASCII length could make timingSafeEqual throw; enforce 43-character ASCII base64url before comparison.
- Upload-session hash wrongly placed in CommitInfo; per-call content_hash now generated at top level for every chunk. Whole-file hash semantics clarified.
- Empty shared-link filter became null; only void users routes now send null.
- Bodyless content download Content-Type removed to match official SDK.
- Deprecated password visibility option without password removed.
- Safe numeric correct_offset preserved and revision before_rev pagination exposed.

Reviewer independently ran the full suite: 30 passed, 0 failed, including HTTP/stdio and regressions. Verdict: APPROVE code/artifact release. No remaining high-confidence code/API release blocker. Real Dropbox consent, refresh, file/sharing operations and team support remain unqualified until live proof.

After review, patched dependency pins were selected: SDK 1.32.2, Express 4.22.3, Zod 4.6.7 (v3 compatibility API), and SDK-compatible @hono/node-server 2.1.3 override. Production audit zero vulnerabilities. Final independent verification also passed on these pins: typecheck/build, 30/30 tests and zero production vulnerabilities. Reviewer final verdict APPROVED. The stale readiness checklist and schema-derived examples were corrected before publication.
