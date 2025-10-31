import protobuf from "protobufjs";
export declare function loadProtoRoot(): Promise<protobuf.Root>;
export declare function postProto<TReq extends object, TRes = any>(url: string, authToken: string, typeFullNameReq: string, typeFullNameRes: string, payload: TReq, timeoutMs?: number): Promise<TRes>;
//# sourceMappingURL=proto.d.ts.map