import fs from "fs-extra";
import path from "path";
import { getProjectDirForWorkspace, getProjectRootDir } from "../utils/env.js";
function getWorkspaceStateFile(workspacePath) {
    const dir = getProjectDirForWorkspace(workspacePath);
    return path.join(dir, "state.json");
}
export async function loadWorkspaceState(workspacePath) {
    const file = getWorkspaceStateFile(workspacePath);
    await fs.ensureDir(path.dirname(file));
    try {
        return (await fs.readJSON(file));
    }
    catch {
        return { workspacePath };
    }
}
export async function saveWorkspaceState(st) {
    const file = getWorkspaceStateFile(st.workspacePath);
    await fs.ensureDir(path.dirname(file));
    const toPersist = {
        workspacePath: st.workspacePath,
        codebaseId: st.codebaseId,
        pathKey: st.pathKey,
        orthogonalTransformSeed: st.orthogonalTransformSeed,
        repoName: st.repoName,
        repoOwner: st.repoOwner,
    };
    await fs.writeJSON(file, toPersist, { spaces: 2 });
}
export function getWorkspaceProjectDir(workspacePath) {
    return getProjectDirForWorkspace(workspacePath);
}
export async function listIndexedWorkspaces() {
    const root = getProjectRootDir();
    await fs.ensureDir(root);
    const out = new Set();
    try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory())
                continue;
            const dir = path.join(root, e.name);
            const stFile = path.join(dir, "state.json");
            try {
                const st = (await fs.readJSON(stFile));
                if (st && st.workspacePath)
                    out.add(st.workspacePath);
            }
            catch {
                // ignore invalid state files
            }
        }
    }
    catch {
        // noop
    }
    return Array.from(out);
}
// Runtime-only cache for codebaseId mapping; persisted copy lives in state.json.
const runtimeCodebaseIds = new Map();
export function setRuntimeCodebaseId(workspacePath, codebaseId) {
    runtimeCodebaseIds.set(workspacePath, codebaseId);
}
export function getRuntimeCodebaseId(workspacePath) {
    return runtimeCodebaseIds.get(workspacePath);
}
export function clearRuntimeCodebaseId(workspacePath) {
    runtimeCodebaseIds.delete(workspacePath);
}
//# sourceMappingURL=stateManager.js.map