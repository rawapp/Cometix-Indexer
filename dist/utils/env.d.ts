export type ResolvedConfig = {
    authToken: string;
    baseUrl: string;
    logLevel: "debug" | "info" | "warning" | "error";
};
export declare function resolveAuthAndBaseUrlFromCliAndEnv(argv: string[]): ResolvedConfig;
export declare function defaultHeaders(authToken: string): Record<string, string>;
export declare function getProjectRootDir(): string;
export declare function getProjectDirForWorkspace(workspacePath: string): string;
export declare const DEFAULTS: {
    SYNC_CONCURRENCY: number;
    SYNC_MAX_NODES: number;
    SYNC_MAX_ITERATIONS: number;
    SYNC_LIST_LIMIT: number;
    FILE_SIZE_LIMIT_BYTES: number;
    INITIAL_UPLOAD_MAX_FILES: number;
    PROTO_TIMEOUT_MS: number;
    PROTO_SEARCH_TIMEOUT_MS: number;
    AUTO_SYNC_INTERVAL_MS: number;
};
//# sourceMappingURL=env.d.ts.map