# Official source checks — 2026-10-29

- https://dropbox.github.io/dropbox-sdk-js/ — Node 22+, generated API and transfer helpers. Implementation uses API v2 directly with native fetch, no SDK-managed token custody.
- https://dropbox.github.io/dropbox-sdk-js/Dropbox.html — routes, scopes, simple-upload 150 MiB ceiling, sequential sessions and cursor routes.
- https://raw.githubusercontent.com/dropbox/dropbox-sdk-js/main/types/dropbox_types.d.ts — exact argument shapes, top-level per-call content_hash, CommitInfo, shared settings and union tags. Independent review used this to correct initial mocks.
- https://docs.dropboxapi.com/dropbox-api/docs/oauth (redirected from supplied OAuth guide) — scoped access, Full Dropbox/App Folder, confidential code flow, PKCE, token_access_type=offline and refresh tokens.
- https://docs.dropboxapi.com/dropbox-api/docs/error-handling — prefix/category errors, X-Dropbox-Request-Id, 400/401 behavior, 429 Retry-After and bounded backoff.
- https://docs.dropboxapi.com/dropbox-api/docs/team-files — Path-Root and Select-User/Admin distinction; team token support excluded until tested.
- https://www.dropbox.com/developers/reference/content-hash — 4 MiB block SHA-256 digests followed by SHA-256 of concatenated digests.

Documented, not yet live-proven: all Dropbox file and sharing operations, app-console setup, production approval, real OAuth consent and refresh. Current live broker provider configuration was read independently, secret-free. Its two unused file_requests scopes are a least-privilege follow-up.
