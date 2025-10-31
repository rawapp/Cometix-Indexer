import { searchRepositoryV2 } from "../client/cursorApi.js";
import path from "path";
import fs from "fs-extra";
import crypto from "crypto";
import { loadWorkspaceState, listIndexedWorkspaces } from "./stateManager.js";
import { V1MasterKeyedEncryptionScheme, decryptPathToRelPosix } from "../crypto/pathEncryption.js";
import picomatch from "picomatch";

export type SearchParams = {
  query: string;
  pathsIncludeGlob?: string;
  pathsExcludeGlob?: string;
  maxResults: number;
};

export function createCodeSearcher(ctx: { authToken: string; baseUrl: string }, indexer: { autoSyncIfNeeded: (workspacePath: string) => Promise<void> }) {
  async function search(params: SearchParams) {
    // Determine the single indexed workspace to search within
    const indexed = await listIndexedWorkspaces();
    if (indexed.length !== 1) {
      throw new Error("codebase_search requires exactly one indexed workspace. Please ensure a single workspace is indexed.");
    }
    const workspacePath = indexed[0];

    // pre-search sync if pending changes
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
    } as any;
    const res = await searchRepositoryV2(ctx.baseUrl, ctx.authToken, {
      query: params.query,
      repository: repositoryPb,
      topK: params.maxResults,
    });
    const codeResults = (res?.code_results || res?.codeResults || []) as any[];
    const scheme = new V1MasterKeyedEncryptionScheme(st.pathKey);
    const hits = codeResults.map((r) => {
      const block = r?.code_block || r?.codeBlock || {};
      const encPath = block.relative_workspace_path || block.relativeWorkspacePath || "unknown";
      let decPath = encPath;
      try {
        decPath = decryptPathToRelPosix(scheme, encPath);
      } catch {
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
      if (includeMatcher && !includeMatcher(p)) return false;
      if (excludeMatcher && excludeMatcher(p)) return false;
      return true;
    });
    return { total: filtered.length, hits: filtered.slice(0, params.maxResults) };
  }
  return { search };
}

