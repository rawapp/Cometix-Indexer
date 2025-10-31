export type WorkspaceState = {
    workspacePath: string;
    codebaseId?: string;
    pathKey?: string;
    orthogonalTransformSeed?: number;
    repoName?: string;
    repoOwner?: string;
    pendingChanges?: boolean;
};
export declare function loadWorkspaceState(workspacePath: string): Promise<WorkspaceState>;
export declare function saveWorkspaceState(st: WorkspaceState): Promise<void>;
export declare function getWorkspaceProjectDir(workspacePath: string): string;
export declare function listIndexedWorkspaces(): Promise<string[]>;
export declare function setRuntimeCodebaseId(workspacePath: string, codebaseId: string): void;
export declare function getRuntimeCodebaseId(workspacePath: string): string | undefined;
export declare function clearRuntimeCodebaseId(workspacePath: string): void;
//# sourceMappingURL=stateManager.d.ts.map