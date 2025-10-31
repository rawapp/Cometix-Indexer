export declare class V1MasterKeyedEncryptionScheme {
    private masterKeyRaw;
    private macKey;
    private encKey;
    constructor(masterKeyBase64Url: string);
    exportKey(): string;
    encrypt(segment: string): string;
    decrypt(encSegment: string): string;
}
export declare function toWindowsRelative(pathStr: string): string;
export declare function toPosixRelative(pathStr: string): string;
export declare function encryptPathSegments(plainPath: string, scheme: V1MasterKeyedEncryptionScheme): string;
export declare function decryptPathSegments(encPath: string, scheme: V1MasterKeyedEncryptionScheme): string;
export declare function encryptPathWindows(scheme: V1MasterKeyedEncryptionScheme, relPosix: string): string;
export declare function decryptPathToRelPosix(scheme: V1MasterKeyedEncryptionScheme, encPath: string): string;
export declare function genPathKey(): string;
export declare function sha256Hex(str: string): string;
//# sourceMappingURL=pathEncryption.d.ts.map