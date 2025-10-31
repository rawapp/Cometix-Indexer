#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpServer } from "./server";
import { resolveAuthAndBaseUrlFromCliAndEnv } from "./utils/env";

async function main() {
  const { authToken, baseUrl, logLevel } = resolveAuthAndBaseUrlFromCliAndEnv(process.argv.slice(2));

  const server = new Server({ name: "cometix-indexer", version: "0.0.1" }, {
    capabilities: {
      prompts: {},
      tools: {},
      resources: {},
      sampling: {},
    },
  });

  await createMcpServer(server, { authToken, baseUrl });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();


