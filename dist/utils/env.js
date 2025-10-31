import os from "os";
import path from "path";
import crypto from "crypto";
export function resolveAuthAndBaseUrlFromCliAndEnv(argv) {
    let authToken = process.env.CURSOR_AUTH_TOKEN || process.env.AUTH_TOKEN || "";
    let baseUrl = (process.env.CURSOR_BASE_URL || "https://api2.cursor.sh").replace(/\/$/, "");
    let logLevel = process.env.LOG_LEVEL || "info";
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--auth-token") {
            const v = argv[i + 1];
            if (v)
                authToken = v;
            i++;
        }
        else if (a === "--base-url") {
            const v = argv[i + 1];
            if (v)
                baseUrl = v.replace(/\/$/, "");
            i++;
        }
        else if (a === "--log-level") {
            const v = argv[i + 1];
            if (v === "debug" || v === "info" || v === "warning" || v === "error")
                logLevel = v;
            i++;
        }
    }
    // Allow starting without token so the MCP server can advertise tools; individual tools will error if token is missing
    return { authToken, baseUrl, logLevel };
}
export function defaultHeaders(authToken) {
    const h = {
        Authorization: `Bearer ${authToken}`,
        "user-agent": "connect-es/1.6.1",
        "Content-Type": "application/proto",
        "x-cursor-client-version": "1.5.5"
    };
    return h;
}
export function getProjectRootDir() {
    const home = os.homedir();
    return path.join(home, ".cometix", "cursor-indexer");
}
function sha256HexLocal(str) {
    return crypto.createHash("sha256").update(str).digest("hex");
}
export function getProjectDirForWorkspace(workspacePath) {
    const base = getProjectRootDir();
    const safeName = workspacePath
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 60) || "project";
    const hash = sha256HexLocal(workspacePath).slice(0, 10);
    return path.join(base, `${safeName}-${hash}`);
}
export const DEFAULTS = {
    SYNC_CONCURRENCY: parseInt(process.env.SYNC_CONCURRENCY || "16", 10), // High concurrency for faster scanning
    SYNC_MAX_NODES: parseInt(process.env.SYNC_MAX_NODES || "2000", 10),
    SYNC_MAX_ITERATIONS: parseInt(process.env.SYNC_MAX_ITERATIONS || "10000", 10),
    SYNC_LIST_LIMIT: parseInt(process.env.SYNC_LIST_LIMIT || "2000", 10), // Support larger codebases
    FILE_SIZE_LIMIT_BYTES: parseInt(process.env.FILE_SIZE_LIMIT_BYTES || String(500 * 1024), 10), // 500KB - most source files are < 100KB
    INITIAL_UPLOAD_MAX_FILES: parseInt(process.env.INITIAL_UPLOAD_MAX_FILES || "500", 10), // Large batches for speed
    PROTO_TIMEOUT_MS: parseInt(process.env.PROTO_TIMEOUT_MS || "120000", 10), // 2min for large batches
    PROTO_SEARCH_TIMEOUT_MS: parseInt(process.env.PROTO_SEARCH_TIMEOUT_MS || "60000", 10),
    AUTO_SYNC_INTERVAL_MS: parseInt(process.env.AUTO_SYNC_INTERVAL_MS || String(5 * 60 * 1000), 10),
};
//# sourceMappingURL=env.js.map