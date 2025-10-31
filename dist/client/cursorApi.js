import { postProto } from "./proto.js";
export async function fastRepoInitHandshakeV2(baseUrl, authToken, req) {
    return postProto(baseUrl + "/aiserver.v1.RepositoryService/FastRepoInitHandshakeV2", authToken, "aiserver.v1.FastRepoInitHandshakeV2Request", "aiserver.v1.FastRepoInitHandshakeV2Response", req);
}
export async function fastUpdateFileV2(baseUrl, authToken, payload) {
    return postProto(baseUrl + "/aiserver.v1.RepositoryService/FastUpdateFileV2", authToken, "aiserver.v1.FastUpdateFileV2Request", "aiserver.v1.FastUpdateFileV2Response", payload);
}
export async function ensureIndexCreated(baseUrl, authToken, repository) {
    return postProto(baseUrl + "/aiserver.v1.RepositoryService/EnsureIndexCreated", authToken, "aiserver.v1.EnsureIndexCreatedRequest", "aiserver.v1.EnsureIndexCreatedResponse", { repository });
}
export async function fastRepoSyncComplete(baseUrl, authToken, payload) {
    return postProto(baseUrl + "/aiserver.v1.RepositoryService/FastRepoSyncComplete", authToken, "aiserver.v1.FastRepoSyncCompleteRequest", "aiserver.v1.FastRepoSyncCompleteResponse", payload);
}
export async function syncMerkleSubtreeV2(baseUrl, authToken, payload) {
    return postProto(baseUrl + "/aiserver.v1.RepositoryService/SyncMerkleSubtreeV2", authToken, "aiserver.v1.SyncMerkleSubtreeV2Request", "aiserver.v1.SyncMerkleSubtreeV2Response", payload);
}
export async function searchRepositoryV2(baseUrl, authToken, payload) {
    return postProto(baseUrl + "/aiserver.v1.RepositoryService/SearchRepositoryV2", authToken, "aiserver.v1.SearchRepositoryRequest", "aiserver.v1.SearchRepositoryResponse", payload);
}
//# sourceMappingURL=cursorApi.js.map