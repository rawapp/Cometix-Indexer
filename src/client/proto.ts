import path from "path";
import fs from "fs-extra";
import protobuf from "protobufjs";
import { DEFAULTS, defaultHeaders } from "../utils/env.js";

let protoRootPromise: Promise<protobuf.Root> | undefined;

export function loadProtoRoot(): Promise<protobuf.Root> {
  if (!protoRootPromise) {
    const protoPath = path.resolve(process.cwd(), "proto/repository_service.proto");
    if (!fs.existsSync(protoPath)) {
      throw new Error(`repository_service.proto not found at proto/repository_service.proto (relative to project root).`);
    }
    protoRootPromise = protobuf.load(protoPath);
  }
  return protoRootPromise;
}

export async function postProto<TReq extends object, TRes = any>(
  url: string,
  authToken: string,
  typeFullNameReq: string,
  typeFullNameRes: string,
  payload: TReq,
  timeoutMs = DEFAULTS.PROTO_TIMEOUT_MS,
): Promise<TRes> {
  const root = await loadProtoRoot();
  const TypeReq = root.lookupType(typeFullNameReq);
  if (!TypeReq) throw new Error(`Missing proto type: ${typeFullNameReq}`);
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
    } as RequestInit);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${txt}`);
    }
    const arrBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrBuf);
    try {
      const TypeRes = root.lookupType(typeFullNameRes);
      if (!TypeRes) throw new Error("Missing response type");
      const msg = TypeRes.decode(buf);
      const obj = TypeRes.toObject(msg, { longs: String, enums: String, defaults: true });
      return obj as TRes;
    } catch {
      try {
        const json = JSON.parse(buf.toString("utf8"));
        return json as TRes;
      } catch {
        return {} as TRes;
      }
    }
  } finally {
    clearTimeout(t);
  }
}


