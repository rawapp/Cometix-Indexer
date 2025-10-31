import { searchRepositoryV2 } from "../client/cursorApi.js";
import crypto from "crypto";
import { loadWorkspaceState, listIndexedWorkspaces } from "./stateManager.js";
import { V1MasterKeyedEncryptionScheme, decryptPathToRelPosix } from "../crypto/pathEncryption.js";
import picomatch from "picomatch";
export function createCodeSearcher(ctx, indexer) {
    async function search(params) {
        console.error(`[SEARCH] Starting search for: "${params.query}"`);
        // Determine the single indexed workspace to search within
        const indexed = await listIndexedWorkspaces();
        if (indexed.length !== 1) {
            throw new Error("codebase_search requires exactly one indexed workspace. Please ensure a single workspace is indexed.");
        }
        const workspacePath = indexed[0];
        console.error(`[SEARCH] Using workspace: ${workspacePath}`);
        // pre-search sync if pending changes
        console.error(`[SEARCH] Checking for pending changes...`);
        await indexer.autoSyncIfNeeded(workspacePath);
        const st = await loadWorkspaceState(workspacePath);
        if (!st.codebaseId || !st.pathKey) {
            throw new Error("Workspace not indexed yet. Run index_project first.");
        }
        const repositoryPb = {
            relativeWorkspacePath: ".",
            isTracked: false,
            isLocal: true,
            numFiles: 0,
            orthogonalTransformSeed: st.orthogonalTransformSeed || 0,
            preferredEmbeddingModel: "EMBEDDING_MODEL_UNSPECIFIED",
            workspaceUri: "",
            // Reuse stable identity from state; fall back to deterministic default
            repoName: st.repoName || `local-${crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 12)}`,
            repoOwner: st.repoOwner || "local-user",
            remoteUrls: [],
            remoteNames: [],
        };
        console.error(`[SEARCH] Querying remote index (codebaseId: ${st.codebaseId})...`);
        const res = await searchRepositoryV2(ctx.baseUrl, ctx.authToken, {
            query: params.query,
            repository: repositoryPb,
            topK: params.maxResults,
        });
        const codeResults = (res?.code_results || res?.codeResults || []);
        console.error(`[SEARCH] Received ${codeResults.length} results from server`);
        const scheme = new V1MasterKeyedEncryptionScheme(st.pathKey);
        const hits = codeResults.map((r) => {
            const block = r?.code_block || r?.codeBlock || {};
            const encPath = block.relative_workspace_path || block.relativeWorkspacePath || "unknown";
            let decPath = encPath;
            try {
                decPath = decryptPathToRelPosix(scheme, encPath);
            }
            catch {
                // fallback to original
            }
            const range = block.range || {};
            const sp = range.start_position || range.startPosition || {};
            const ep = range.end_position || range.endPosition || {};
            const score = r?.score ?? 0;
            return { path: decPath, score, startLine: sp.line ?? null, endLine: ep.line ?? null };
        });
        // Apply include/exclude globs if provided
        const includeMatcher = params.pathsIncludeGlob ? picomatch(params.pathsIncludeGlob) : null;
        const excludeMatcher = params.pathsExcludeGlob ? picomatch(params.pathsExcludeGlob) : null;
        const filtered = hits.filter((h) => {
            const p = h.path.startsWith("./") ? h.path.slice(2) : h.path;
            if (includeMatcher && !includeMatcher(p))
                return false;
            if (excludeMatcher && excludeMatcher(p))
                return false;
            return true;
        });
        console.error(`[SEARCH] ✓ Search complete! Returning ${filtered.slice(0, params.maxResults).length} results (filtered from ${codeResults.length})`);
        return { total: filtered.length, hits: filtered.slice(0, params.maxResults) };
    }
    return { search };
}
//# sourceMappingURL=codeSearcher.js.map