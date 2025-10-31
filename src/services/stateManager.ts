import fs from "fs-extra";
import path from "path";
import { getProjectDirForWorkspace, getProjectRootDir } from "../utils/env.js";

export type IndexingProgress = {
  status: "idle" | "scanning" | "uploading" | "completed" | "error";
  message?: string;
  currentBatch?: number;
  totalBatches?: number;
  uploadedFiles?: number;
  totalFiles?: number;
  startedAt?: string;
  estimatedCompletion?: string;
  error?: string;
};

export type WorkspaceState = {
  workspacePath: string;
  codebaseId?: string;
  pathKey?: string;
  orthogonalTransformSeed?: number;
  repoName?: string;
  repoOwner?: string;
  // Ephemeral (not persisted):
  pendingChanges?: boolean;
  // Indexing progress (runtime only, not persisted to disk)
  indexingProgress?: IndexingProgress;
};

// Runtime-only progress tracking (not persisted to disk)
const indexingProgressMap = new Map<string, IndexingProgress>();

function getWorkspaceStateFile(workspacePath: string): string {
  const dir = getProjectDirForWorkspace(workspacePath);
  return path.join(dir, "state.json");
}

export function setIndexingProgress(workspacePath: string, progress: IndexingProgress): void {
  indexingProgressMap.set(workspacePath, progress);
}

export function getIndexingProgress(workspacePath: string): IndexingProgress | undefined {
  return indexingProgressMap.get(workspacePath);
}

export function clearIndexingProgress(workspacePath: string): void {
  indexingProgressMap.delete(workspacePath);
}

export async function loadWorkspaceState(workspacePath: string): Promise<WorkspaceState> {
  const file = getWorkspaceStateFile(workspacePath);
  await fs.ensureDir(path.dirname(file));
  try {
    return (await fs.readJSON(file)) as WorkspaceState;
  } catch {
    return { workspacePath };
  }
}

export async function saveWorkspaceState(st: WorkspaceState): Promise<void> {
  const file = getWorkspaceStateFile(st.workspacePath);
  await fs.ensureDir(path.dirname(file));
  const toPersist: WorkspaceState = {
    workspacePath: st.workspacePath,
    codebaseId: st.codebaseId,
    pathKey: st.pathKey,
    orthogonalTransformSeed: st.orthogonalTransformSeed,
    repoName: st.repoName,
    repoOwner: st.repoOwner,
  };
  await fs.writeJSON(file, toPersist, { spaces: 2 });
}

export function getWorkspaceProjectDir(workspacePath: string): string {
  return getProjectDirForWorkspace(workspacePath);
}

export async function listIndexedWorkspaces(): Promise<string[]> {
  const root = getProjectRootDir();
  await fs.ensureDir(root);
  const out = new Set<string>();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      const stFile = path.join(dir, "state.json");
      try {
        const st = (await fs.readJSON(stFile)) as WorkspaceState;
        if (st && st.workspacePath) out.add(st.workspacePath);
      } catch {
        // ignore invalid state files
      }
    }
  } catch {
    // noop
  }
  return Array.from(out);
}

// Runtime-only cache for codebaseId mapping; persisted copy lives in state.json.
const runtimeCodebaseIds = new Map<string, string>();

export function setRuntimeCodebaseId(workspacePath: string, codebaseId: string): void {
  runtimeCodebaseIds.set(workspacePath, codebaseId);
}

export function getRuntimeCodebaseId(workspacePath: string): string | undefined {
  return runtimeCodebaseIds.get(workspacePath);
}

export function clearRuntimeCodebaseId(workspacePath: string): void {
  runtimeCodebaseIds.delete(workspacePath);
}

