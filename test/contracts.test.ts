import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  DropboxClient,
  contentHash,
  decodeBase64,
  MAX_BYTES,
  ConnectionRequired,
  SafeError,
} from "../src/api-client.js";
import { execute, tools } from "../src/tools.js";
import { resolver } from "../src/broker-client.js";
import { app } from "../src/http.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const fake = "mock-access-value";
const c = {
  base: "https://connectionsbroker.agenticledger.ai",
  namespace: "test-namespace",
  bearer: "test-install",
  key: "test-key",
};
const mocked = (
  fn: (url: string, init: RequestInit) => Response | Promise<Response>,
) => (async (u, i) => fn(String(u), i ?? {})) as typeof fetch;
const result = (r: Awaited<ReturnType<typeof execute>>) =>
  JSON.parse(r.content[0].text);
test("Dropbox content hash known algorithm and empty vector", () => {
  assert.equal(
    contentHash(Buffer.alloc(0)),
    createHash("sha256").update(Buffer.alloc(0)).digest("hex"),
  );
  const a = Buffer.alloc(4 * 1024 * 1024 + 1, 1);
  const blocks = [
    a.subarray(0, 4 * 1024 * 1024),
    a.subarray(4 * 1024 * 1024),
  ].map((b) => createHash("sha256").update(b).digest());
  assert.equal(
    contentHash(a),
    createHash("sha256").update(Buffer.concat(blocks)).digest("hex"),
  );
});
test("canonical base64 caps and malformed input", () => {
  assert.equal(decodeBase64("eA==").toString(), "x");
  assert.throws(() => decodeBase64("not base64!"));
  assert.throws(() =>
    decodeBase64("A".repeat(Math.ceil(MAX_BYTES / 3) * 4 + 4)),
  );
});
test("all tools unique, strict schemas and mutation confirmations", () => {
  assert.equal(new Set(tools.map((t) => t.name)).size, 33);
  for (const t of tools) {
    assert.equal(t.schema.safeParse({ unknown: "value" }).success, false);
    if (t.write) assert(t.schema.shape.confirm);
  }
});
test("read headers, fixed v2 URL, path root and raw unicode JSON", async () => {
  const client = new DropboxClient(
    async () => fake,
    mocked((url, i) => {
      assert.equal(url, "https://api.dropboxapi.com/2/files/get_metadata");
      assert.equal(
        (i.headers as Record<string, string>).Authorization,
        "Bearer " + fake,
      );
      assert.equal(
        (i.headers as Record<string, string>)["Dropbox-API-Path-Root"],
        JSON.stringify({ ".tag": "namespace_id", namespace_id: "123" }),
      );
      assert.deepEqual(JSON.parse(i.body as string), { path: "/é.txt" });
      return Response.json({ ".tag": "file", name: "é.txt" });
    }),
  );
  await client.call(
    "files/get_metadata",
    { path: "/é.txt" },
    { pathRoot: "123" },
  );
  await assert.rejects(client.call("https://evil.example", {}));
});
test("path injection/traversal and unknown args blocked before transport", async () => {
  let calls = 0;
  const client = new DropboxClient(
    async () => fake,
    mocked(() => {
      calls++;
      return Response.json({});
    }),
  );
  for (const path of [
    "/a/../b",
    "file:///etc/passwd",
    "https://evil.example",
    "/a\\b",
    "/a\n",
  ]) {
    assert.equal(
      result(await execute("dropbox_metadata_get", { path }, client)).error,
      "invalid_arguments",
    );
  }
  assert.equal(calls, 0);
});
test("writes disabled and confirm required", async () => {
  let calls = 0;
  const client = new DropboxClient(
    async () => fake,
    mocked(() => {
      calls++;
      return Response.json({});
    }),
  );
  assert.equal(
    result(
      await execute("dropbox_delete", { path: "/x", confirm: true }, client),
    ).error,
    "writes_disabled",
  );
  assert.equal(
    result(await execute("dropbox_delete", { path: "/x" }, client, true)).error,
    "invalid_arguments",
  );
  assert.equal(calls, 0);
});
test("cursor continuation and hard page limit", async () => {
  const client = new DropboxClient(
    async () => fake,
    mocked((url, i) => {
      assert(url.endsWith("files/list_folder/continue"));
      assert.deepEqual(JSON.parse(i.body as string), { cursor: "opaque" });
      return Response.json({
        entries: [{ ".tag": "file" }],
        cursor: "next",
        has_more: true,
      });
    }),
  );
  assert.equal(
    result(
      await execute("dropbox_folder_continue", { cursor: "opaque" }, client),
    ).data.cursor,
    "next",
  );
  assert.equal(
    result(await execute("dropbox_folder_list", { limit: 101 }, client)).error,
    "invalid_arguments",
  );
});
test("download binary bounded hash, untrusted flag and hash mismatch", async () => {
  const bytes = Buffer.from("pdf content");
  const client = new DropboxClient(
    async () => fake,
    mocked((_u, i) => {
      assert.equal(
        (i.headers as Record<string, string>)["Dropbox-API-Arg"],
        '{"path":"/file.pdf"}',
      );
      return new Response(bytes, {
        headers: {
          "Dropbox-API-Result": JSON.stringify({
            content_hash: contentHash(bytes),
          }),
        },
      });
    }),
  );
  const d = (await client.call(
    "files/download",
    { path: "/file.pdf" },
    { download: true },
  )) as any;
  assert.equal(d.base64, bytes.toString("base64"));
  assert.equal(d.hashVerified, true);
  assert.equal(d.untrustedContent, true);
  await assert.rejects(
    client.call(
      "files/download",
      { path: "/file.pdf" },
      { download: true, expectedHash: "0".repeat(64) },
    ),
    { code: "content_hash_mismatch" },
  );
});
test("streamed response and advertised content caps", async () => {
  for (const headers of [{}, { "Content-Length": String(MAX_BYTES + 1) }]) {
    const client = new DropboxClient(
      async () => fake,
      mocked(() => new Response(new Uint8Array(MAX_BYTES + 1), { headers })),
    );
    await assert.rejects(
      client.call("files/download", { path: "/x" }, { download: true }),
      { code: "too_large" },
    );
  }
});
test("simple upload input hash validation and content headers", async () => {
  let calls = 0;
  const client = new DropboxClient(
    async () => fake,
    mocked((_u, i) => {
      calls++;
      const arg = JSON.parse(
        (i.headers as Record<string, string>)["Dropbox-API-Arg"],
      );
      assert.equal(arg.path, "/file");
      assert.equal(arg.confirm, undefined);
      assert.equal(arg.base64, undefined);
      assert.equal(
        (i.headers as Record<string, string>)["Content-Type"],
        "application/octet-stream",
      );
      return Response.json({ content_hash: contentHash(Buffer.from("x")) });
    }),
  );
  const a = { path: "/file", base64: "eA==", confirm: true };
  assert.equal(
    result(
      await execute(
        "dropbox_upload",
        { ...a, expectedHash: "0".repeat(64) },
        client,
        true,
      ),
    ).error,
    "content_hash_mismatch",
  );
  assert.equal(calls, 0);
  assert.equal(
    (await execute("dropbox_upload", a, client, true)).isError,
    undefined,
  );
  assert.equal(calls, 1);
});
test("sequential session start append finish preserve cursor offset and chunk hash", async () => {
  const seen: any[] = [];
  const client = new DropboxClient(
    async () => fake,
    mocked((url, i) => {
      seen.push({
        url,
        args: JSON.parse(
          (i.headers as Record<string, string>)["Dropbox-API-Arg"],
        ),
        bytes: Buffer.from(i.body as Uint8Array).length,
      });
      return url.endsWith("/start")
        ? Response.json({ session_id: "test-session" })
        : url.endsWith("/append_v2")
          ? new Response(null, { status: 200 })
          : Response.json({ name: "large.bin" });
    }),
  );
  await execute(
    "dropbox_session_start",
    { base64: "eA==", confirm: true },
    client,
    true,
  );
  await execute(
    "dropbox_session_append",
    {
      cursor: { session_id: "test-session", offset: 1 },
      base64: "eA==",
      confirm: true,
    },
    client,
    true,
  );
  await execute(
    "dropbox_session_finish",
    {
      cursor: { session_id: "test-session", offset: 2 },
      commit: { path: "/large.bin" },
      base64: "",
      confirm: true,
    },
    client,
    true,
  );
  assert.equal(seen.length, 3);
  assert.equal(seen[1].args.cursor.offset, 1);
  assert.equal(seen[2].args.commit.content_hash, undefined);
  assert.equal(seen[2].args.content_hash, contentHash(Buffer.alloc(0)));
  assert.equal(seen[2].bytes, 0);
});
for (const status of [400, 401, 403, 404, 409, 429, 500])
  test(`safe ${status} normalization, no leaked raw credentials`, async () => {
    let n = 0;
    const client = new DropboxClient(
      async () => fake,
      mocked(() => {
        n++;
        return Response.json(
          { error_summary: "path/not_found/..", secret: fake },
          { status, headers: { "X-Dropbox-Request-Id": "request-id" } },
        );
      }),
      async () => {},
    );
    const r = await execute("dropbox_metadata_get", { path: "/x" }, client);
    const text = JSON.stringify(r);
    assert(!text.includes(fake));
    assert.equal(result(r).status, status);
    assert.equal(result(r).requestId, "request-id");
    assert.equal(n, status === 429 || status === 500 ? 3 : 1);
    if (status === 401)
      assert.equal(result(r).error, "reauthentication_required");
  });
test("write 429 and 500 never automatically retried", async () => {
  for (const status of [429, 500]) {
    let n = 0;
    const client = new DropboxClient(
      async () => fake,
      mocked(() => {
        n++;
        return Response.json({ error_summary: "rate_limit/." }, { status });
      }),
      async () => {},
    );
    await execute(
      "dropbox_delete",
      { path: "/x", confirm: true },
      client,
      true,
    );
    assert.equal(n, 1);
  }
});
test("Retry-After honored with bounded delay; long delay returned", async () => {
  const waits: number[] = [];
  let n = 0;
  const client = new DropboxClient(
    async () => fake,
    mocked(() =>
      ++n < 3
        ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
        : Response.json({}),
    ),
    async (ms) => {
      waits.push(ms);
    },
  );
  await client.call("users/get_current_account", null);
  assert.deepEqual(waits, [2000, 2000]);
  const long = new DropboxClient(
    async () => fake,
    mocked(
      () => new Response("", { status: 429, headers: { "Retry-After": "60" } }),
    ),
    async () => assert.fail(),
  );
  await assert.rejects(long.call("users/get_current_account", null), {
    retryAfterSeconds: 60,
  });
});
test("200 201 204 JSON/void and malformed JSON", async () => {
  for (const status of [200, 201, 204]) {
    const client = new DropboxClient(
      async () => fake,
      mocked(() =>
        status === 204
          ? new Response(null, { status })
          : Response.json({ ok: true }, { status }),
      ),
    );
    assert.deepEqual(
      await client.call(
        "files/create_folder_v2",
        { path: "/x" },
        { write: true },
      ),
      status === 204 ? null : { ok: true },
    );
  }
  const bad = new DropboxClient(
    async () => fake,
    mocked(() => new Response("oops")),
  );
  await assert.rejects(bad.call("users/get_space_usage", null), {
    code: "malformed_response",
  });
});
test("DNS, timeout and transport error text redacted", async () => {
  for (const message of ["DNS " + fake, "Timeout " + fake]) {
    const client = new DropboxClient(
      async () => fake,
      mocked(() => {
        throw new Error(message);
      }),
    );
    await assert.rejects(
      client.call("users/get_space_usage", null),
      (e: any) =>
        e.code === "transport_unavailable" && !e.message.includes(fake),
    );
  }
});
test("broker JWT/account binding and connect-on-first-call", async () => {
  const fetcher = mocked((url, i) => {
    const h = i.headers as Record<string, string>;
    assert.equal(h.Authorization, "Bearer test-install");
    const decoded = jwt.verify(h["X-Broker-Token"], c.key, {
      algorithms: ["HS256"],
    }) as any;
    assert.equal(decoded.principal, "instance:agent");
    assert.equal(decoded.clientNamespace, c.namespace);
    assert.equal(decoded.exp - decoded.iat, 60);
    assert.equal(JSON.parse(i.body as string).account, "work");
    return url.endsWith("/token")
      ? new Response(null, { status: 404 })
      : Response.json({
          authorizeUrl: "https://www.dropbox.com/oauth2/authorize?state=mock",
        });
  });
  await assert.rejects(
    resolver("instance:agent", "work", c, fetcher)(),
    ConnectionRequired,
  );
});
test("broker failures, malicious connect URL and no token leakage", async () => {
  for (const status of [401, 500])
    await assert.rejects(
      resolver(
        "caller",
        "",
        c,
        mocked(() => new Response(fake, { status })),
      )(),
      SafeError,
    );
  await assert.rejects(
    resolver(
      "caller",
      "",
      c,
      mocked((url) =>
        url.endsWith("/token")
          ? new Response(null, { status: 404 })
          : Response.json({
              authorizeUrl: "https://evil.example/oauth2/authorize",
            }),
      ),
    )(),
    { code: "invalid_connect_url" },
  );
});
test("HTTP MCP mock initialize list call; write disabled; auth discovery absent", async () => {
  const server = app({ DROPBOX_MOCK_MODE: "true" }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const a = server.address() as any;
  const url = `http://127.0.0.1:${a.port}`;
  const client = new Client({ name: "test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + "/mcp")),
    );
    assert.equal((await client.listTools()).tools.length, 33);
    const r = await client.callTool({
      name: "dropbox_account_get",
      arguments: {},
    });
    assert(JSON.stringify(r).includes("mock"));
    assert.equal(
      (await fetch(url + "/.well-known/oauth-authorization-server")).status,
      404,
    );
    assert.equal((await fetch(url + "/health")).status, 200);
  } finally {
    await client.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("HTTP broker gate and configured principal/HMAC isolation", async () => {
  for (const env of [
    {},
    {
      BROKER_BASE_URL: c.base,
      BROKER_CLIENT_NAMESPACE: c.namespace,
      BROKER_INSTALL_BEARER: c.bearer,
      BROKER_JWT_KEY: c.key,
      BROKER_PRINCIPAL_HMAC_KEY: "hmac",
    },
  ]) {
    const server = app(env).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const a = server.address() as any;
    try {
      const r = await fetch(`http://127.0.0.1:${a.port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Broker-Principal": randomUUID(),
        },
        body: "{}",
      });
      assert.equal(r.status, "BROKER_JWT_KEY" in env ? 401 : 503);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }
});
test("stdio MCP mock initialize list safe call", async () => {
  const client = new Client({ name: "stdio-test", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["dist/index.js"],
        env: { ...process.env, DROPBOX_MOCK_MODE: "true" } as Record<
          string,
          string
        >,
        stderr: "pipe",
      }),
    );
    assert.equal((await client.listTools()).tools.length, 33);
    assert(
      JSON.stringify(
        await client.callTool({ name: "dropbox_account_get", arguments: {} }),
      ).includes("mock"),
    );
  } finally {
    await client.close();
  }
});

test("empty shared link filter stays object while void account args are null", async () => {
  const seen: unknown[] = [];
  const client = new DropboxClient(
    async () => fake,
    mocked((_u, i) => {
      seen.push(JSON.parse(i.body as string));
      return Response.json({});
    }),
  );
  await execute("dropbox_shared_links_list", {}, client);
  await execute("dropbox_account_get", {}, client);
  assert.deepEqual(seen, [{}, null]);
});

test("safe incorrect_offset preserves provider numeric offset without raw body", async () => {
  const client = new DropboxClient(
    async () => fake,
    mocked(() =>
      Response.json(
        {
          error_summary: "lookup_failed/incorrect_offset/.",
          error: {
            ".tag": "lookup_failed",
            lookup_failed: { ".tag": "incorrect_offset", correct_offset: 123 },
          },
          secret: fake,
        },
        { status: 409 },
      ),
    ),
  );
  const r = result(
    await execute(
      "dropbox_session_append",
      { cursor: { session_id: "id", offset: 0 }, base64: "", confirm: true },
      client,
      true,
    ),
  );
  assert.equal(r.correctOffset, 123);
  assert(!JSON.stringify(r).includes(fake));
});
test("non-ASCII signature rejected without unhandled timingSafeEqual exception", async () => {
  const server = app({
    BROKER_CLIENT_NAMESPACE: c.namespace,
    BROKER_INSTALL_BEARER: c.bearer,
    BROKER_JWT_KEY: c.key,
    BROKER_PRINCIPAL_HMAC_KEY: "hmac",
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const a = server.address() as any;
  try {
    const r = await fetch(`http://127.0.0.1:${a.port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Broker-Principal": "diagnostic",
        "X-Broker-Principal-Sig": "é".repeat(43),
      },
      body: "{}",
    });
    assert.equal(r.status, 401);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
