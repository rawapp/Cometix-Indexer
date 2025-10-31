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
    autoSyncIfNeeded: (workspacePath: string) => Promise<void>;
    scheduleAutoSync: (workspacePath: string) => void;
};
//# sourceMappingURL=repositoryIndexer.d.ts.map