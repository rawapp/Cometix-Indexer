#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpServer } from "./server.js";
import { resolveAuthAndBaseUrlFromCliAndEnv } from "./utils/env.js";
import fs from "fs";
// Log to stderr (stdout is reserved for MCP protocol)
function log(level, message, error) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    // Always log to stderr
    console.error(logMessage);
    // Also log errors with stack traces
    if (error) {
        console.error(error);
    }
    // Optionally log to file
    const logFile = process.env.COMETIX_LOG_FILE;
    if (logFile) {
        try {
            const fullMessage = error ? `${logMessage}\n${error.stack || error}\n` : `${logMessage}\n`;
            fs.appendFileSync(logFile, fullMessage);
        }
        catch (e) {
            // Ignore file write errors
        }
    }
}
async function main() {
    try {
        const { authToken, baseUrl, logLevel } = resolveAuthAndBaseUrlFromCliAndEnv(process.argv.slice(2));
        log("INFO", `Starting Cometix Indexer v0.0.1`);
        log("INFO", `Base URL: ${baseUrl}`);
        log("INFO", `Auth token: ${authToken ? "***configured***" : "NOT SET"}`);
        log("INFO", `Log level: ${logLevel}`);
        const server = new Server({ name: "cometix-indexer", version: "0.0.1" }, {
            capabilities: {
                prompts: {},
                tools: {},
                resources: {},
                sampling: {},
            },
        });
        log("INFO", "Creating MCP server...");
        await createMcpServer(server, { authToken, baseUrl });
        log("INFO", "Connecting transport...");
        const transport = new StdioServerTransport();
        await server.connect(transport);
        log("INFO", "MCP server started successfully");
    }
    catch (error) {
        log("ERROR", "Failed to start MCP server", error);
        process.exit(1);
    }
}
// Handle uncaught errors
process.on("uncaughtException", (error) => {
    // EPIPE and ECONNRESET are common when clients disconnect - gracefully shutdown
    if (error?.code === "EPIPE" || error?.code === "ECONNRESET") {
        // Don't log to stderr as it might trigger more EPIPE errors
        // Just exit gracefully
        process.exit(0);
    }
    log("ERROR", "Uncaught exception", error);
    process.exit(1);
});
process.on("unhandledRejection", (reason) => {
    log("ERROR", "Unhandled rejection", reason);
    process.exit(1);
});
// SIGPIPE is already ignored by Node.js by default - no handler needed
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
//# sourceMappingURL=index.js.map