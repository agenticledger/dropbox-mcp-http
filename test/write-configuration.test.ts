import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { app } from "../src/http.js";

const cases = [
  {
    name: "dropbox_folder_create",
    args: { path: "/scratch" },
    route: "files/create_folder_v2",
  },
  {
    name: "dropbox_upload",
    args: { path: "/scratch/file.txt", base64: "eA==" },
    route: "files/upload",
  },
  {
    name: "dropbox_move",
    args: {
      from_path: "/scratch/file.txt",
      to_path: "/scratch/moved/file.txt",
    },
    route: "files/move_v2",
  },
  {
    name: "dropbox_move",
    args: { from_path: "/scratch/file.txt", to_path: "/scratch/renamed.txt" },
    route: "files/move_v2",
  },
  {
    name: "dropbox_shared_folder_share",
    args: { path: "/scratch" },
    route: "sharing/share_folder",
  },
  {
    name: "dropbox_shared_link_create",
    args: { path: "/scratch/file.txt" },
    route: "sharing/create_shared_link_with_settings",
  },
  {
    name: "dropbox_delete",
    args: { path: "/scratch" },
    route: "files/delete_v2",
  },
];

async function session(env: NodeJS.ProcessEnv) {
  let credentialResolutions = 0;
  const server = createServer(
    () => async () => {
      credentialResolutions++;
      return "synthetic-test-access-token";
    },
    env,
  );
  const client = new Client({
    name: "write-configuration-contract",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    server,
    resolutions: () => credentialResolutions,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
function payload(result: unknown): Record<string, unknown> {
  return JSON.parse(
    (result as { content: { text: string }[] }).content[0].text,
  );
}

test("write configuration: omitted, false and nonliteral values fail before credentials or provider access", async () => {
  for (const value of [undefined, "false", "TRUE", "1", "true "]) {
    const s = await session(
      value === undefined ? {} : { DROPBOX_ENABLE_WRITES: value },
    );
    try {
      const list = (await s.client.listTools()).tools;
      assert.equal(list.length, 33);
      for (const c of cases) {
        assert(
          list.some(
            (t) => t.name === c.name && t.annotations?.readOnlyHint === false,
          ),
        );
        const result = await s.client.callTool({
          name: c.name,
          arguments: { ...c.args, confirm: true },
        });
        assert.equal(payload(result).error, "writes_disabled");
      }
      assert.equal(s.resolutions(), 0);
    } finally {
      await s.close();
    }
  }
});

test("write configuration: exact true enables guarded create/upload/move/rename/share/delete routing", async () => {
  const originalFetch = globalThis.fetch;
  const calls: {
    route: string;
    args: Record<string, unknown>;
    authorization: string | undefined;
  }[] = [];
  globalThis.fetch = (async (input, init) => {
    const u = new URL(String(input));
    assert(
      ["api.dropboxapi.com", "content.dropboxapi.com"].includes(u.hostname),
    );
    const headers = init?.headers as Record<string, string>;
    const args = JSON.parse(headers["Dropbox-API-Arg"] ?? String(init?.body));
    calls.push({
      route: u.pathname.replace("/2/", ""),
      args,
      authorization: headers.Authorization,
    });
    // Mocked Dropbox contract response; no request reaches Dropbox.
    return Response.json({ ".tag": "complete", metadata: { name: "scratch" } });
  }) as typeof fetch;
  const s = await session({ DROPBOX_ENABLE_WRITES: "true" });
  try {
    for (const c of cases) {
      const result = await s.client.callTool({
        name: c.name,
        arguments: { ...c.args, confirm: true },
      });
      assert.equal((result as { isError?: boolean }).isError, undefined);
      assert.equal(calls.at(-1)?.route, c.route);
      assert.equal(calls.at(-1)?.args.confirm, undefined);
      assert.equal(
        calls.at(-1)?.authorization,
        "Bearer synthetic-test-access-token",
      );
    }
    assert.equal(calls.length, cases.length);
    assert.equal(s.resolutions(), cases.length);
    for (const c of cases) {
      for (const confirm of [undefined, false, "true"]) {
        const result = await s.client.callTool({
          name: c.name,
          arguments: {
            ...c.args,
            ...(confirm === undefined ? {} : { confirm }),
          },
        });
        assert.equal(payload(result).error, "invalid_arguments");
      }
    }
    const invalidPath = await s.client.callTool({
      name: "dropbox_delete",
      arguments: { path: "/scratch/../private", confirm: true },
    });
    assert.equal(payload(invalidPath).error, "invalid_arguments");
    assert.equal(calls.length, cases.length);
    assert.equal(s.resolutions(), cases.length);
  } finally {
    await s.close();
    globalThis.fetch = originalFetch;
  }
});

test("write configuration: enabled health truth does not open unauthenticated MCP", async () => {
  const server = app({
    DROPBOX_ENABLE_WRITES: "true",
    BROKER_CLIENT_NAMESPACE: "dropbox-mcp-prod",
    BROKER_INSTALL_BEARER: "synthetic-install",
    BROKER_JWT_KEY: "synthetic-signing-key",
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  try {
    const base = `http://127.0.0.1:${address.port}`;
    const health = await (await fetch(base + "/health")).json();
    assert.equal(health.writesEnabled, true);
    assert.equal(health.brokerConfigured, true);
    assert.equal(health.mockMode, false);
    assert.equal(health.clientNamespace, "dropbox-mcp-prod");
    assert.equal(health.tools, 33);
    const response = await fetch(base + "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "no-identity", version: "1" },
        },
      }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "caller_principal_required");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
