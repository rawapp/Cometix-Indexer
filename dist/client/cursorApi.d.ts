export type RepositoryPb = {
    relativeWorkspacePath: string;
    isTracked: boolean;
    isLocal: boolean;
    numFiles: number;
    orthogonalTransformSeed: number;
    preferredEmbeddingModel: string;
    workspaceUri: string;
    repoName: string;
    repoOwner: string;
    remoteUrls: string[];
    remoteNames: string[];
};
export type ClientRepositoryInfoPb = {
    orthogonalTransformSeed: number;
};
export type FastRepoInitHandshakeV2Request = {
    repository: RepositoryPb;
    rootHash: string;
    similarityMetricType: string;
    similarityMetric: number[];
    pathKeyHash: string;
    pathKeyHashType: string;
    pathKey: string;
};
export declare function fastRepoInitHandshakeV2(baseUrl: string, authToken: string, req: FastRepoInitHandshakeV2Request): Promise<any>;
export declare function fastUpdateFileV2(baseUrl: string, authToken: string, payload: any): Promise<any>;
export declare function ensureIndexCreated(baseUrl: string, authToken: string, repository: RepositoryPb): Promise<any>;
export declare function fastRepoSyncComplete(baseUrl: string, authToken: string, payload: any): Promise<any>;
export declare function syncMerkleSubtreeV2(baseUrl: string, authToken: string, payload: any): Promise<any>;
export declare function searchRepositoryV2(baseUrl: string, authToken: string, payload: any): Promise<any>;
//# sourceMappingURL=cursorApi.d.ts.map