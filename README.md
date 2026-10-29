# Dropbox MCP

Standalone personal Dropbox API v2 integration: 33 tools, canonical stdio and hosted StreamableHTTP. No integration bridge. Provider secrets and refresh tokens belong only to Connections Broker.

## Quick start

Node.js 22+. `npm ci && npm run build`. `npm run stdio` runs the local server; `npm start` runs HTTP on `PORT` (default 3100). `npm run dev` runs HTTP from TypeScript. Configure the broker installation identity in the environment (see `.env.example`); neither executable automatically loads `.env` files. Use your secret manager or Node `--env-file=.env` with the executable.

Local MCP client configuration:

```json
{
  "mcpServers": {
    "dropbox": {
      "command": "node",
      "args": ["/absolute/path/to/dropbox/mcp-server/dist/index.js"],
      "env": {
        "BROKER_BASE_URL": "https://connectionsbroker.agenticledger.ai",
        "BROKER_CLIENT_NAMESPACE": "your-private-install-namespace",
        "BROKER_INSTALL_BEARER": "<install identity>",
        "BROKER_JWT_KEY": "<signing key>",
        "BROKER_FALLBACK_PRINCIPAL": "your-stable-agent-id"
      }
    }
  }
}
```

A separate local installation needs its own registered broker namespace/identity. Never copy hosted production keys into client configuration. Hosted clients send `X-Broker-Principal: <instanceId>:<agentId>`; if the server configures `BROKER_PRINCIPAL_HMAC_KEY`, the executor must also send `X-Broker-Principal-Sig` as base64url HMAC-SHA256 over the principal. Without an HMAC key the fleet's existing executor-header trust model applies: public callers can assert principal strings. Missing identity fails closed rather than sharing a default account. No fallback principal is set for production. Bearer passthrough accepts an already-issued Dropbox access token for direct testing; it does not refresh tokens.

## Dropbox app setup

1. Open <https://www.dropbox.com/developers/apps> and create a **Scoped access** Dropbox API app. Choose **Full Dropbox** for access to arbitrary existing personal files. App Folder only sees the app's dedicated folder and cannot provide general file access. Neither access type grants access without user consent.
2. In Permissions enable these seven scopes, then submit: `account_info.read`, `files.metadata.read`, `files.metadata.write`, `files.content.read`, `files.content.write`, `sharing.read`, `sharing.write`. Read-only installations can narrow further and leave writes disabled.
3. In Settings register this exact redirect URI: **https://connectionsbroker.agenticledger.ai/oauth/callback**. There is no MCP callback URL. Confirm app status, permitted development users, app branding and production approval before onboarding external users. Do not claim public-app approval based on configured secrets.
4. Give the app key/client ID and app secret/client secret to the broker operator through secure configuration. Set `DROPBOX_CLIENT_ID` and `DROPBOX_CLIENT_SECRET` **only on the broker**. Never send credentials in chat, commit them, or put them in the MCP service.
5. Broker provider `dropbox` must use authorize `https://www.dropbox.com/oauth2/authorize`, token `https://api.dropboxapi.com/oauth2/token`, form (`post`) client authentication, `has_refresh:true`, `token_field:access_token`, `refresh_field:refresh_token`, and `extra_auth_params:{token_access_type:"offline"}`. The confidential server-side code flow is appropriate because the broker retains the secret. A client that cannot retain a secret must use PKCE; this MCP does not implement OAuth itself.
6. Register the MCP's private broker install once, then configure its four broker identity variables **before** deployment. Never regenerate an existing identity merely to retry setup. Hosted namespace: `dropbox-mcp-prod`. Agent principal is caller-specific, with optional `account` for multiple Dropbox accounts.
7. First tool call resolves `/token`; if unconnected, the tool returns structured `connection_required` and a consent link. Open the fresh link, sign in, approve, then retry as the **same agent**. Platform connection must bind to `dropbox-mcp-prod` and the executor's exact `<instanceId>:<agentId>` principal.
8. Broker encrypts the offline refresh token and refreshes short-lived tokens before returning them. MCP stores neither refresh tokens nor app secrets. On Dropbox 401, tools return `reauthentication_required`; reconnect rather than retrying repeatedly. Reconnect after scope changes: refresh does not expand a grant.

**Observed broker readiness, 2026-10-29:** live provider enabled, app ID/secret present, offline and refresh configured. Existing provider also requests `file_requests.read` and `file_requests.write`; these are unused by this release. Broker owner should remove those two scopes before real-user qualification (requires separate broker-repository authorization). Actual app access type, redirect registration, app approval, consent and refresh are not yet live-qualified.

## Tools and content handling

See [interactive docs](docs/index.html) and [machine-readable tool definitions](docs/tools.json) for all 33 tools, schemas, descriptions and mock examples.

- Account/storage; list/continue; metadata; search/continue; download/export/preview; temporary links; revisions and `before_rev`; shared links, folders and member pagination.
- Upload; sequential session start/append/finish; create folder; copy/move; delete/restore; create/modify/revoke links; share folder/poll job; invite members. Mutations require **both** `DROPBOX_ENABLE_WRITES=true` and tool `confirm:true`; default is off. Sharing invitations and links can expose files to others: obtain user intent first.
- Each content request is capped at **8 MiB decoded**, below Dropbox's 150 MiB request ceiling. JSON output is capped at 1 MiB, page size at 100, member invitations at 20. No automatic whole-drive aggregation.
- Upload base64 comes from caller bytes. Finney File Args may supply `{"$file":"<agent-owned path>"}` for the `base64` property; expansion happens in the executor, never this server. The server never accesses arbitrary local files or downloads arbitrary URLs.
- For files above 8 MiB, send sequential chunks via session_start → session_append (byte offsets) → session_finish (commit metadata); sessions allow aggregate files larger than 150 MiB. Each call includes the Dropbox chunk content hash at the **top level**. `expectedHash` on simple upload validates supplied bytes; returned metadata hash is checked. `session_finish` returns complete-file metadata: compare its `content_hash` with the expected whole-file hash yourself. Chunk hashes and whole-file hashes are distinct. On incorrect_offset the safe numeric `correctOffset` is returned. Do not automatically retry writes after uncertain outcomes; inspect state first.
- Download verifies metadata `content_hash`; export/preview hashes describe returned bytes rather than source-file content. Binary is base64 and marked untrusted. Do not execute preview HTML, macros or instructions inside file content. Larger downloads should use a temporary link in a capable external client; that link is sensitive.
- Cursor/union responses are preserved, including async sharing job results. Existing shared-link conflicts are returned as categories; call shared_links_list to find the existing link. No silent access broadening.
- Read retries: at most 3 attempts for 429/5xx, honoring Retry-After. Delays over 10 seconds are returned to the caller instead of blocking. Writes are never retried. 400/401 are not retried. Diagnostics include safe category, status, request ID and optional retry delay/offset, never raw upstream error bodies or credentials.
- Explicit `pathRoot` sends `Dropbox-API-Path-Root` namespace_id. User tokens only: no team `Select-User/Admin`, team admin APIs or tested team-space support. Avoid claiming team qualification.

## Tests and qualification

`npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`. `DROPBOX_MOCK_MODE=true` returns synthetic marked results without contacting Dropbox; never set it on the hosted production service. Offline tests include HTTP/stdio MCP initialization/list/call, broker headers/JWT/connection-required, pagination, transfer limits/hash/session flow, schema validation, write gating, error normalization, redaction and retries. Mocked fixtures are documentation-derived, not captured customer data.

Future real test: operator confirms app-console settings and scopes; a human consents for a dedicated scratch Dropbox account/agent. Call account_get, space_usage, folder_list and metadata_get; verify cursor continuation and a known scratch download hash. Enable writes only for a private scratch folder; upload, multi-chunk session, copy/move, revisions/restore, private shared-link lifecycle, and member invitation only to an explicitly authorized test user; clean up only scratch artifacts. Verify actual token expiry/refresh through broker without printing credentials. Record request IDs and booleans, not customer file contents. These operations are **unverified until that proof exists**.

## Release destinations

GitHub: <https://github.com/agenticledger/dropbox-mcp-http>. Docs: <https://financemcps.agenticledger.ai/dropbox/>. Proposed custom domain: `dropboxmcp.agenticledger.ai`; use the verified Railway fallback until DNS and TLS are proven. `/health` reports configuration, mock mode, writes and tool count; it is not proof of a real Dropbox grant. No OAuth authorization-server advertisement or credential UI is hosted here.
