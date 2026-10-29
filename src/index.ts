#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { resolver } from "./broker-client.js";
const principal = process.env.BROKER_FALLBACK_PRINCIPAL ?? "";
await createServer((account) => resolver(principal, account)).connect(
  new StdioServerTransport(),
);
