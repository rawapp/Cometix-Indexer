export declare function shouldIgnore(fileAbs: string, workspacePath: string): boolean;
export declare function clearGitignoreCache(workspacePath?: string): void;
export declare function listFiles(workspacePath: string, limit?: number): Promise<string[]>;
export declare function readEmbeddableFilesList(root: string, listPath: string): Promise<string[]>;
//# sourceMappingURL=fs.d.ts.map