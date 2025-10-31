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
    pendingChanges?: boolean;
    indexingProgress?: IndexingProgress;
};
export declare function setIndexingProgress(workspacePath: string, progress: IndexingProgress): void;
export declare function getIndexingProgress(workspacePath: string): IndexingProgress | undefined;
export declare function clearIndexingProgress(workspacePath: string): void;
export declare function loadWorkspaceState(workspacePath: string): Promise<WorkspaceState>;
export declare function saveWorkspaceState(st: WorkspaceState): Promise<void>;
export declare function getWorkspaceProjectDir(workspacePath: string): string;
export declare function listIndexedWorkspaces(): Promise<string[]>;
export declare function setRuntimeCodebaseId(workspacePath: string, codebaseId: string): void;
export declare function getRuntimeCodebaseId(workspacePath: string): string | undefined;
export declare function clearRuntimeCodebaseId(workspacePath: string): void;
//# sourceMappingURL=stateManager.d.ts.map