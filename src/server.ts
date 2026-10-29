import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { DropboxClient, type Resolver } from "./api-client.js";
import { execute, tools } from "./tools.js";
export function createServer(
  resolve: (account: string) => Resolver,
  env: NodeJS.ProcessEnv = process.env,
) {
  const server = new Server(
    { name: "dropbox-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema) as { type: "object" },
      annotations: {
        readOnlyHint: !t.write,
        destructiveHint: t.write,
        idempotentHint: !t.write,
        openWorldHint: true,
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (r) => {
    const raw = r.params.arguments ?? {};
    const account = typeof raw.account === "string" ? raw.account : "";
    return execute(
      r.params.name,
      raw,
      new DropboxClient(resolve(account)),
      env.DROPBOX_ENABLE_WRITES === "true",
      env.DROPBOX_MOCK_MODE === "true",
    );
  });
  return server;
}
