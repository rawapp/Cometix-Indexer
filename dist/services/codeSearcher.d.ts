export type SearchParams = {
    query: string;
    pathsIncludeGlob?: string;
    pathsExcludeGlob?: string;
    maxResults: number;
};
export declare function createCodeSearcher(ctx: {
    authToken: string;
    baseUrl: string;
}, indexer: {
    autoSyncIfNeeded: (workspacePath: string) => Promise<void>;
}): {
    search: (params: SearchParams) => Promise<{
        total: number;
        hits: {
            path: any;
            score: any;
            startLine: any;
            endLine: any;
        }[];
    }>;
};
//# sourceMappingURL=codeSearcher.d.ts.map