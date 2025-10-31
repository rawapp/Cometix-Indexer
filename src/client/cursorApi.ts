import { postProto } from "./proto.js";

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

export type ClientRepositoryInfoPb = { orthogonalTransformSeed: number };

export type FastRepoInitHandshakeV2Request = {
  repository: RepositoryPb;
  rootHash: string;
  similarityMetricType: string;
  similarityMetric: number[];
  pathKeyHash: string;
  pathKeyHashType: string;
  pathKey: string;
};

export async function fastRepoInitHandshakeV2(baseUrl: string, authToken: string, req: FastRepoInitHandshakeV2Request): Promise<any> {
  return postProto(
    baseUrl + "/aiserver.v1.RepositoryService/FastRepoInitHandshakeV2",
    authToken,
    "aiserver.v1.FastRepoInitHandshakeV2Request",
    "aiserver.v1.FastRepoInitHandshakeV2Response",
    req,
  );
}

export async function fastUpdateFileV2(baseUrl: string, authToken: string, payload: any): Promise<any> {
  return postProto(
    baseUrl + "/aiserver.v1.RepositoryService/FastUpdateFileV2",
    authToken,
    "aiserver.v1.FastUpdateFileV2Request",
    "aiserver.v1.FastUpdateFileV2Response",
    payload,
  );
}

export async function ensureIndexCreated(baseUrl: string, authToken: string, repository: RepositoryPb): Promise<any> {
  return postProto(
    baseUrl + "/aiserver.v1.RepositoryService/EnsureIndexCreated",
    authToken,
    "aiserver.v1.EnsureIndexCreatedRequest",
    "aiserver.v1.EnsureIndexCreatedResponse",
    { repository },
  );
}

export async function fastRepoSyncComplete(baseUrl: string, authToken: string, payload: any): Promise<any> {
  return postProto(
    baseUrl + "/aiserver.v1.RepositoryService/FastRepoSyncComplete",
    authToken,
    "aiserver.v1.FastRepoSyncCompleteRequest",
    "aiserver.v1.FastRepoSyncCompleteResponse",
    payload,
  );
}

export async function syncMerkleSubtreeV2(baseUrl: string, authToken: string, payload: any): Promise<any> {
  return postProto(
    baseUrl + "/aiserver.v1.RepositoryService/SyncMerkleSubtreeV2",
    authToken,
    "aiserver.v1.SyncMerkleSubtreeV2Request",
    "aiserver.v1.SyncMerkleSubtreeV2Response",
    payload,
  );
}

export async function searchRepositoryV2(baseUrl: string, authToken: string, payload: any): Promise<any> {
  return postProto(
    baseUrl + "/aiserver.v1.RepositoryService/SearchRepositoryV2",
    authToken,
    "aiserver.v1.SearchRepositoryRequest",
    "aiserver.v1.SearchRepositoryResponse",
    payload,
  );
}


