import { ListToolsRequestSchema, ListToolsResultSchema, CallToolRequestSchema, CompatibilityCallToolResultSchema, ListPromptsRequestSchema, ListPromptsResultSchema, ListResourcesRequestSchema, ListResourcesResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createRepositoryIndexer } from "./services/repositoryIndexer.js";
import { createCodeSearcher } from "./services/codeSearcher.js";
export async function createMcpServer(server, ctx) {
    const indexer = createRepositoryIndexer(ctx);
    const searcher = createCodeSearcher(ctx, indexer);
    // Zod schemas for tool arguments
    const indexProjectArgsSchema = z.object({
        workspacePath: z.string(),
        verbose: z.boolean().optional(),
        rescan: z.boolean().optional(),
    });
    const indexStatusArgsSchema = z.object({
        workspacePath: z.string(),
    });
    const codebaseSearchArgsSchema = z.object({
        query: z.string(),
        paths_include_glob: z.string().optional(),
        paths_exclude_glob: z.string().optional(),
        max_results: z.number().int().positive().optional(),
    });
    // Minimal JSON Schemas for MCP tool inputSchema (top-level must be type: "object")
    const indexProjectInputJsonSchema = {
        type: "object",
        properties: {
            workspacePath: { type: "string" },
            verbose: { type: "boolean" },
            rescan: { type: "boolean" },
        },
        required: ["workspacePath"],
    };
    const indexStatusInputJsonSchema = {
        type: "object",
        properties: {
            workspacePath: { type: "string" },
        },
        required: ["workspacePath"],
    };
    const codebaseSearchInputJsonSchema = {
        type: "object",
        properties: {
            query: { type: "string" },
            paths_include_glob: { type: "string" },
            paths_exclude_glob: { type: "string" },
            max_results: { type: "integer", minimum: 1 },
        },
        required: ["query"],
    };
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return ListToolsResultSchema.parse({
            tools: [
                {
                    name: "index_project",
                    description: "Starts indexing a codebase (runs in background, returns immediately with estimated time). First-time indexing automatically scans and respects .gitignore rules. Subsequent calls use cached file list for speed. Set `rescan: true` ONLY if .gitignore was modified since last index - this forces full workspace re-scan. Use `index_status` to monitor progress. Estimated time: ~5-15s for <100 files, ~20-60s for 100-500 files, ~1-3min for 500-1000 files.",
                    inputSchema: indexProjectInputJsonSchema,
                },
                {
                    name: "index_status",
                    description: "Check indexing progress. Returns: status (idle/scanning/uploading/completed/error), current/total batches, uploaded/total files, progress %, estimated completion time. Poll this every 5-10 seconds while status is 'scanning' or 'uploading' to monitor progress. When status='completed', indexing is done.",
                    inputSchema: indexStatusInputJsonSchema,
                },
                {
                    name: "codebase_search",
                    description: "Searches the indexed codebase to find code snippets most relevant to a natural language query. This is a semantic search tool, so the query should describe the desired functionality or concept. For best results, use the user's exact phrasing for the `query`, as their specific wording often contains valuable semantic cues. If the search should be limited to specific files or directories, use the `paths_include_glob` and `paths_exclude_glob` parameters to scope the search. Ensure the project has been indexed with `index_project` first.",
                    inputSchema: codebaseSearchInputJsonSchema,
                },
            ],
        });
    });
    // No-op prompt/resources handlers to satisfy advertised capabilities
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        return ListPromptsResultSchema.parse({ prompts: [] });
    });
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        return ListResourcesResultSchema.parse({ resources: [] });
    });
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const { name, arguments: args } = req.params;
        console.error(`[TOOL] Received tool call: ${name}`);
        console.error(`[TOOL] Arguments: ${JSON.stringify(args)}`);
        // Friendly guard: ensure auth token is present at call time
        const missingTokenError = () => CompatibilityCallToolResultSchema.parse({
            content: [{ type: "text", text: "Missing CURSOR_AUTH_TOKEN. Pass --auth-token or set env CURSOR_AUTH_TOKEN before using this tool." }],
            isError: true,
        });
        if (!ctx.authToken) {
            console.error(`[TOOL] ERROR: Missing auth token`);
            return missingTokenError();
        }
        if (name === "index_project") {
            console.error(`[TOOL] Processing index_project...`);
            try {
                const { workspacePath, verbose, rescan } = indexProjectArgsSchema.parse(args || {});
                console.error(`[TOOL] Parsed args - workspacePath: ${workspacePath}, verbose: ${verbose}, rescan: ${rescan}`);
                // Start indexing in background and get estimation
                console.error(`[TOOL] Starting background indexing task...`);
                const estimate = await indexer.indexProjectAsync({ workspacePath, verbose: !!verbose, rescan: !!rescan });
                // Return immediately with estimated time
                const response = {
                    status: "started",
                    message: "Indexing started in background. Use index_status to check progress.",
                    workspacePath,
                    estimatedTime: estimate.estimatedDescription,
                    estimatedCompletionAt: estimate.estimatedCompletion,
                    instructions: [
                        `Expected to complete in ${estimate.estimatedDescription}`,
                        "Monitor progress: Call index_status({ workspacePath: \"" + workspacePath + "\" })",
                        "View detailed logs: tail -f " + (process.env.COMETIX_LOG_FILE || "/tmp/cometix-indexer.log"),
                    ]
                };
                console.error(`[TOOL] Returned immediate response (estimated: ${estimate.estimatedDescription}), indexing continues in background`);
                return CompatibilityCallToolResultSchema.parse({
                    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
                });
            }
            catch (error) {
                console.error(`[TOOL] ERROR in index_project:`, error);
                throw error;
            }
        }
        if (name === "index_status") {
            console.error(`[TOOL] Processing index_status...`);
            try {
                const { workspacePath } = indexStatusArgsSchema.parse(args || {});
                const status = await indexer.getIndexStatus(workspacePath);
                console.error(`[TOOL] index_status result: ${status.status}`);
                return CompatibilityCallToolResultSchema.parse({
                    content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
                });
            }
            catch (error) {
                console.error(`[TOOL] ERROR in index_status:`, error);
                throw error;
            }
        }
        if (name === "codebase_search") {
            console.error(`[TOOL] Processing codebase_search...`);
            try {
                const { query, paths_include_glob, paths_exclude_glob, max_results } = codebaseSearchArgsSchema.parse(args || {});
                const result = await searcher.search({
                    query,
                    pathsIncludeGlob: paths_include_glob,
                    pathsExcludeGlob: paths_exclude_glob,
                    maxResults: (typeof max_results === "number" && max_results > 0) ? max_results : 10,
                });
                console.error(`[TOOL] codebase_search completed successfully`);
                return CompatibilityCallToolResultSchema.parse({
                    content: [{ type: "text", text: JSON.stringify(result) }],
                });
            }
            catch (error) {
                console.error(`[TOOL] ERROR in codebase_search:`, error);
                throw error;
            }
        }
        console.error(`[TOOL] ERROR: Unknown tool: ${name}`);
        return CompatibilityCallToolResultSchema.parse({ content: [{ type: "text", text: "Unknown tool" }], isError: true });
    });
}
//# sourceMappingURL=server.js.map