import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { configured, config, resolver } from "./broker-client.js";
import { tools } from "./tools.js";
export function app(env: NodeJS.ProcessEnv = process.env) {
  const application = express();
  application.disable("x-powered-by");
  application.use(express.json({ limit: "12mb" }));
  application.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      server: "dropbox-mcp-http",
      version: "1.0.0",
      tools: tools.length,
      authModel: "broker-first",
      brokerConfigured: configured(config(env)),
      brokerProvider: "dropbox",
      clientNamespace: config(env).namespace || null,
      writesEnabled: env.DROPBOX_ENABLE_WRITES === "true",
      mockMode: env.DROPBOX_MOCK_MODE === "true",
    }),
  );
  application.get("/", (_req, res) =>
    res.json({
      name: "Dropbox MCP",
      mcpEndpoint: "/mcp",
      docs: "https://financemcps.agenticledger.ai/dropbox/",
      teamSupport: "not qualified",
    }),
  );
  application.post("/mcp", async (req, res) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec(
      req.header("authorization") ?? "",
    )?.[1];
    const principal = (
      req.header("x-broker-principal") ??
      env.BROKER_FALLBACK_PRINCIPAL ??
      ""
    ).trim();
    if (
      !bearer &&
      env.DROPBOX_MOCK_MODE !== "true" &&
      !configured(config(env))
    ) {
      res.status(503).json({ error: "broker_unconfigured" });
      return;
    }
    if (
      !bearer &&
      (!principal || principal.length > 512 || /[\x00-\x1f]/.test(principal)) &&
      env.DROPBOX_MOCK_MODE !== "true"
    ) {
      res.status(401).json({
        error: "caller_principal_required",
        message:
          "Send executor-stamped X-Broker-Principal or a raw Dropbox Bearer access token.",
      });
      return;
    }
    if (!bearer && env.BROKER_PRINCIPAL_HMAC_KEY) {
      const sig = req.header("x-broker-principal-sig") ?? "";
      const expected = createHmac("sha256", env.BROKER_PRINCIPAL_HMAC_KEY)
        .update(principal)
        .digest("base64url");
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(sig) ||
        !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      ) {
        res.status(401).json({ error: "invalid_principal_signature" });
        return;
      }
    }
    const server = createServer(
      (account) =>
        bearer ? async () => bearer : resolver(principal, account, config(env)),
      env,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(500).json({ error: "mcp_request_failed" });
    }
  });
  application.get("/mcp", (_req, res) => res.status(405).end());
  application.delete("/mcp", (_req, res) => res.status(405).end());
  application.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ error: "invalid_or_excessive_request" });
    },
  );
  return application;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  app().listen(Number(process.env.PORT ?? 3100), "0.0.0.0", () =>
    console.error("Dropbox MCP HTTP listening"),
  );
}
