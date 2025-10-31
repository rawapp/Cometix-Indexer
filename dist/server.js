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
        workspacePath: z.string(),
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
            workspacePath: { type: "string" },
            paths_include_glob: { type: "string" },
            paths_exclude_glob: { type: "string" },
            max_results: { type: "integer", minimum: 1 },
        },
        required: ["query", "workspacePath"],
    };
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return ListToolsResultSchema.parse({
            tools: [
                {
                    name: "index_project",
                    description: "Starts indexing (background task, returns immediately with estimated completion time). Auto-scans with .gitignore on first run. Uses cached file list on subsequent runs (faster). Set rescan=true ONLY if .gitignore was modified. Returns estimated time - WAIT for that duration, then call index_status to verify completion. Time estimates: 10-20s (<100 files), 20-60s (100-500 files), 1-3min (500-1000 files). Don't poll index_status before estimated time - let indexing finish first!",
                    inputSchema: indexProjectInputJsonSchema,
                },
                {
                    name: "index_status",
                    description: "Check indexing progress. IMPORTANT: Only call this AFTER the estimated time from index_project has passed. Returns: status (idle/scanning/uploading/completed/error), progress %, batch info, remaining time. If status='completed', you can start searching. If still 'uploading', wait 10 more seconds and check again. Status values: idle (not started/already done), scanning (finding files), uploading (sending to server), completed (ready to search), error (failed - check error field).",
                    inputSchema: indexStatusInputJsonSchema,
                },
                {
                    name: "codebase_search",
                    description: "Searches indexed codebase using semantic search. REQUIRED: workspacePath must match the path used in index_project. Query describes functionality/concept in natural language. Use paths_include_glob/paths_exclude_glob to filter results. Must call index_project first to index the workspace.",
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
                    message: `Indexing started in background. Estimated completion in ${estimate.estimatedDescription}.`,
                    workspacePath,
                    estimatedTime: estimate.estimatedDescription,
                    estimatedCompletionAt: estimate.estimatedCompletion,
                    nextStep: `Wait ${estimate.whenToCheck}, then call index_status to verify completion`,
                    instructions: [
                        `⏱️  Estimated time: ${estimate.estimatedDescription}`,
                        `⏰  Wait until ${new Date(estimate.estimatedCompletion).toLocaleTimeString('zh-CN')}`,
                        `📊  Then check: index_status({ workspacePath: "${workspacePath}" })`,
                        `📝  Watch logs: tail -f ${process.env.COMETIX_LOG_FILE || "/tmp/cometix-indexer.log"}`,
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
                const { query, workspacePath, paths_include_glob, paths_exclude_glob, max_results } = codebaseSearchArgsSchema.parse(args || {});
                const result = await searcher.search({
                    query,
                    workspacePath,
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