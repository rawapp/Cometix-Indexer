import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";
import protobuf from "protobufjs";
import { DEFAULTS, defaultHeaders } from "../utils/env.js";
let protoRootPromise;
export function loadProtoRoot() {
    if (!protoRootPromise) {
        // Get the directory of this module file
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        // Proto file is at ../../proto/repository_service.proto relative to dist/client/proto.js
        const protoPath = path.resolve(__dirname, "../../proto/repository_service.proto");
        if (!fs.existsSync(protoPath)) {
            throw new Error(`repository_service.proto not found at ${protoPath}. ` +
                `Expected location: proto/repository_service.proto relative to package root. ` +
                `Current module: ${__filename}`);
        }
        protoRootPromise = protobuf.load(protoPath);
    }
    return protoRootPromise;
}
export async function postProto(url, authToken, typeFullNameReq, typeFullNameRes, payload, timeoutMs = DEFAULTS.PROTO_TIMEOUT_MS) {
    const root = await loadProtoRoot();
    const TypeReq = root.lookupType(typeFullNameReq);
    if (!TypeReq)
        throw new Error(`Missing proto type: ${typeFullNameReq}`);
    const message = TypeReq.create(payload);
    const buffer = TypeReq.encode(message).finish();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: defaultHeaders(authToken),
            body: Buffer.from(buffer),
            signal: controller.signal,
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status} ${res.statusText}: ${txt}`);
        }
        const arrBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrBuf);
        try {
            const TypeRes = root.lookupType(typeFullNameRes);
            if (!TypeRes)
                throw new Error("Missing response type");
            const msg = TypeRes.decode(buf);
            const obj = TypeRes.toObject(msg, { longs: String, enums: String, defaults: true });
            return obj;
        }
        catch {
            try {
                const json = JSON.parse(buf.toString("utf8"));
                return json;
            }
            catch {
                return {};
            }
        }
    }
    finally {
        clearTimeout(t);
    }
}
//# sourceMappingURL=proto.js.map