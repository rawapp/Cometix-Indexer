import { IndexingProgress } from "./stateManager.js";
export type IndexerContext = {
    authToken: string;
    baseUrl: string;
};
export declare function createRepositoryIndexer(ctx: IndexerContext): {
    indexProject: (params: {
        workspacePath: string;
        verbose?: boolean;
        rescan?: boolean;
    }) => Promise<any>;
    indexProjectAsync: (params: {
        workspacePath: string;
        verbose?: boolean;
        rescan?: boolean;
    }) => Promise<{
        estimatedSeconds: number;
        estimatedDescription: string;
        estimatedCompletion: string;
    }>;
    getIndexStatus: (workspacePath: string) => Promise<IndexingProgress>;
    autoSyncIfNeeded: (workspacePath: string) => Promise<void>;
    scheduleAutoSync: (workspacePath: string) => void;
};
//# sourceMappingURL=repositoryIndexer.d.ts.map