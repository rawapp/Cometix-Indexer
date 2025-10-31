import path from "path";
import fs from "fs-extra";
import crypto from "crypto";
import { MerkleClient } from "@anysphere/file-service";
import { DEFAULTS } from "../utils/env.js";
import { listFiles, readEmbeddableFilesList, shouldIgnore } from "../utils/fs.js";
import { Semaphore } from "../utils/semaphore.js";
import { V1MasterKeyedEncryptionScheme, decryptPathToRelPosix, encryptPathWindows, genPathKey, sha256Hex } from "../crypto/pathEncryption.js";
import { ensureIndexCreated, fastRepoInitHandshakeV2, fastRepoSyncComplete, fastUpdateFileV2, syncMerkleSubtreeV2 } from "../client/cursorApi.js";
import { loadWorkspaceState, saveWorkspaceState, setRuntimeCodebaseId, getRuntimeCodebaseId } from "./stateManager.js";
import { startFileWatcher } from "./fileWatcher.js";
export function createRepositoryIndexer(ctx) {
    async function buildAncestorSpline(relPath) {
        const parts = relPath.split(path.sep);
        const spline = [];
        let current = "";
        for (let i = 0; i < parts.length - 1; i++) {
            current = path.join(current, parts[i]);
            const rp = current || ".";
            spline.push({ relativeWorkspacePath: rp });
        }
        if (spline.length === 0)
            spline.push({ relativeWorkspacePath: "." });
        return spline;
    }
    async function merkleBuild(workspacePath) {
        const merkle = new MerkleClient({ "": workspacePath });
        const walkCfg = { maxNumFiles: DEFAULTS.SYNC_LIST_LIMIT };
        await merkle.build(true, walkCfg);
        return merkle;
    }
    function createRepositoryPb(workspacePath, seed, repoName) {
        return {
            relativeWorkspacePath: ".",
            isTracked: false,
            isLocal: true,
            numFiles: 0,
            orthogonalTransformSeed: seed,
            preferredEmbeddingModel: "EMBEDDING_MODEL_UNSPECIFIED",
            workspaceUri: "",
            repoName,
            repoOwner: "local-user",
            remoteUrls: [],
            remoteNames: [],
        };
    }
    async function initialHandshake(merkle, st, pathKey, baseUrl, authToken, repoName) {
        const rootHash = await merkle.getSubtreeHash("");
        const simhash = Array.from(await merkle.getSimhash());
        const pathKeyHash = sha256Hex(pathKey);
        const repositoryPb = createRepositoryPb(st.workspacePath, st.orthogonalTransformSeed, repoName);
        const req = {
            repository: repositoryPb,
            rootHash,
            similarityMetricType: "SIMILARITY_METRIC_TYPE_SIMHASH",
            similarityMetric: simhash.map((n) => Number(n)),
            pathKeyHash,
            pathKeyHashType: "PATH_KEY_HASH_TYPE_SHA256",
            pathKey,
        };
        const res = await fastRepoInitHandshakeV2(baseUrl, authToken, req);
        const codebaseId = res?.codebases?.[0]?.codebase_id || res?.codebases?.[0]?.codebaseId;
        if (!codebaseId)
            throw new Error("No codebase_id in handshake response");
        return { codebaseId, repositoryPb, simhash: simhash.map((n) => Number(n)), pathKeyHash };
    }
    async function uploadFilesChunk(filesAbs, workspacePath, scheme, orthogonalTransformSeed, codebaseId, baseUrl, authToken, encryptedToPlainPath) {
        const sem = new Semaphore(DEFAULTS.SYNC_CONCURRENCY);
        let uploaded = 0;
        await Promise.all(filesAbs.map((abs) => sem.withRetrySemaphore(async () => {
            const relPosix = path.relative(workspacePath, abs).replace(/\\/g, "/");
            const relDisplay = (relPosix.startsWith(".") ? relPosix : "./" + relPosix).replace(/\//g, "\\");
            let contents = "";
            try {
                const buf = await fs.readFile(abs);
                if (buf.length > DEFAULTS.FILE_SIZE_LIMIT_BYTES)
                    return; // skip large
                contents = buf.toString("utf8");
            }
            catch {
                return; // skip unreadable
            }
            const enc = encryptPathWindows(scheme, relPosix);
            const localFilePb = {
                file: { relativeWorkspacePath: enc, contents },
                hash: sha256Hex(contents),
                unencryptedRelativeWorkspacePath: relDisplay,
            };
            try {
                const encWin = localFilePb.file.relativeWorkspacePath;
                const encFwd = encWin.replace(/\\/g, "/");
                const encNoDot = encWin.startsWith(".\\") ? encWin.slice(2) : encWin;
                const encNoDotFwd = encNoDot.replace(/\\/g, "/");
                encryptedToPlainPath[encWin] = relDisplay;
                encryptedToPlainPath[encFwd] = relDisplay;
                encryptedToPlainPath[encNoDot] = relDisplay;
                encryptedToPlainPath[encNoDotFwd] = relDisplay;
            }
            catch { /* noop */ }
            const ancestorSplinePb = (await buildAncestorSpline(relPosix)).map((x) => ({
                relativeWorkspacePath: encryptPathWindows(scheme, x.relativeWorkspacePath).replace(/\//g, "\\\\"),
            }));
            const payload = {
                clientRepositoryInfo: { orthogonalTransformSeed },
                codebaseId,
                localFile: localFilePb,
                ancestorSpline: ancestorSplinePb,
                updateType: 1,
            };
            try {
                await fastUpdateFileV2(baseUrl, authToken, payload);
                uploaded++;
            }
            catch {
                // ignore single-file failure
            }
        }, undefined, 3)));
        return uploaded;
    }
    async function runEnsureAndSyncComplete(baseUrl, authToken, repositoryPb, codebaseId, simhash, pathKeyHash) {
        await ensureIndexCreated(baseUrl, authToken, repositoryPb);
        await fastRepoSyncComplete(baseUrl, authToken, {
            codebases: [
                {
                    codebaseId,
                    status: "STATUS_SUCCESS",
                    similarityMetricType: "SIMILARITY_METRIC_TYPE_SIMHASH",
                    similarityMetric: simhash,
                    pathKeyHash,
                    pathKeyHashType: "PATH_KEY_HASH_TYPE_SHA256",
                },
            ],
        });
    }
    async function incrementalSync(workspacePath, merkle, codebaseId, scheme, baseUrl, authToken, orthogonalTransformSeed) {
        const queue = ["."];
        const visited = new Set();
        const r = new Set();
        const n = new Set();
        const s = new Set();
        const abortController = new AbortController();
        const sem = new Semaphore(DEFAULTS.SYNC_CONCURRENCY, abortController.signal);
        async function listDirectChildren(relPosix) {
            const absDir = relPosix === "." ? workspacePath : path.join(workspacePath, relPosix);
            const out = [];
            try {
                const entries = await fs.readdir(absDir, { withFileTypes: true });
                for (const e of entries) {
                    const full = path.join(absDir, e.name);
                    if (shouldIgnore(full, workspacePath))
                        continue;
                    const rel = path.relative(workspacePath, full).replace(/\\/g, "/");
                    out.push({ relPosix: rel === "" ? "." : rel, isDir: e.isDirectory(), isFile: e.isFile() });
                }
            }
            catch { /* noop */ }
            return out;
        }
        async function processNode(relPosix) {
            if (!relPosix || visited.has(relPosix))
                return;
            visited.add(relPosix);
            let hash = "";
            try {
                hash = await merkle.getSubtreeHash(relPosix === "." ? "" : relPosix);
            }
            catch {
                return;
            }
            const encPath = encryptPathWindows(scheme, relPosix === "." ? "" : relPosix);
            let syncRes;
            try {
                syncRes = await syncMerkleSubtreeV2(ctx.baseUrl, ctx.authToken, {
                    clientRepositoryInfo: { orthogonalTransformSeed },
                    codebaseId,
                    localPartialPath: { relativeWorkspacePath: encPath, hashOfNode: hash },
                });
            }
            catch {
                return;
            }
            const match = !!(syncRes && syncRes.match);
            if (match)
                return;
            const childrenHint = (syncRes && syncRes.mismatch && syncRes.mismatch.children) || [];
            if (childrenHint && childrenHint.length > 0) {
                const localChildren = await listDirectChildren(relPosix);
                const decryptedChildren = [];
                for (const child of childrenHint) {
                    const encChild = child.relative_workspace_path || child.relativeWorkspacePath;
                    let plain;
                    try {
                        plain = decryptPathToRelPosix(scheme, encChild);
                    }
                    catch { /* noop */ }
                    if (!plain)
                        continue;
                    const mapping = localChildren.find((c) => c.relPosix === plain);
                    decryptedChildren.push({ enc: encChild, plain, isDir: mapping?.isDir, isFile: mapping?.isFile });
                }
                const localHashMap = new Map();
                for (const c of decryptedChildren) {
                    try {
                        localHashMap.set(c.plain, await merkle.getSubtreeHash(c.plain));
                    }
                    catch {
                        localHashMap.set(c.plain, "-1");
                    }
                }
                const misMatched = [];
                for (const c of childrenHint) {
                    const enc = c.relative_workspace_path || c.relativeWorkspacePath;
                    const dec = decryptedChildren.find((x) => x.enc === enc);
                    if (!dec)
                        continue;
                    const serverH = c.hashOfNode || c.hash_of_node || "";
                    const localH = localHashMap.get(dec.plain) || "";
                    if (!(serverH === localH || localH === "-1" || localH === "")) {
                        misMatched.push({ plain: dec.plain, isDir: dec.isDir, isFile: dec.isFile });
                    }
                }
                const entries = await listDirectChildren(relPosix);
                const trueFiles = entries.filter((e) => e.isFile).map((e) => e.relPosix);
                const trueDirs = entries.filter((e) => e.isDir).map((e) => e.relPosix);
                misMatched.filter((x) => trueFiles.includes(x.plain)).forEach((x) => r.add(x.plain));
                misMatched.filter((x) => trueDirs.includes(x.plain)).forEach((x) => queue.push(x.plain));
                const resolvedPlain = decryptedChildren.map((x) => x.plain);
                const newDirs = trueDirs.filter((p) => !resolvedPlain.includes(p));
                const newFiles = trueFiles.filter((p) => !resolvedPlain.includes(p));
                newDirs.forEach((p) => n.add(p));
                newFiles.forEach((p) => s.add(p));
                return;
            }
            const kids = await listDirectChildren(relPosix);
            if (kids.length === 0) {
                if (relPosix !== ".")
                    s.add(relPosix);
            }
            else {
                for (const k of kids) {
                    if (k.isDir)
                        queue.push(k.relPosix);
                    if (k.isFile)
                        r.add(k.relPosix);
                }
            }
        }
        const running = new Set();
        let iterations = 0;
        while ((queue.length > 0 && iterations < DEFAULTS.SYNC_MAX_ITERATIONS) || running.size > 0) {
            while (queue.length > 0 && iterations < DEFAULTS.SYNC_MAX_ITERATIONS) {
                const relPosix = queue.shift();
                if (!relPosix)
                    break;
                if (visited.has(relPosix))
                    continue;
                iterations++;
                const task = sem.withRetrySemaphore(() => processNode(relPosix), undefined, 3)
                    .catch(() => { })
                    .finally(() => running.delete(task));
                running.add(task);
            }
            if (running.size > 0)
                await Promise.race(running);
        }
        const changed = Array.from(new Set([...Array.from(r), ...Array.from(s)]));
        return changed;
    }
    function chunkArray(arr, size) {
        const out = [];
        for (let i = 0; i < arr.length; i += size)
            out.push(arr.slice(i, i + size));
        return out;
    }
    const startedWatchers = new Set();
    const scheduled = new Set();
    async function indexProject(params) {
        const workspacePath = path.resolve(params.workspacePath);
        let st = await loadWorkspaceState(workspacePath);
        if (!st.orthogonalTransformSeed) {
            st.orthogonalTransformSeed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        }
        let pathKey = st.pathKey;
        if (!pathKey)
            pathKey = genPathKey();
        const scheme = new V1MasterKeyedEncryptionScheme(pathKey);
        // embeddableFilesPath is fixed under per-project directory
        const projectDir = (await import("./stateManager.js")).getWorkspaceProjectDir(workspacePath);
        const defaultListPath = path.join(projectDir, "embeddable_files.txt");
        await fs.ensureDir(path.dirname(defaultListPath));
        if (!(await fs.pathExists(defaultListPath))) {
            const discovered = await listFiles(workspacePath, DEFAULTS.SYNC_LIST_LIMIT);
            await fs.writeFile(defaultListPath, discovered.map((p) => path.relative(workspacePath, p).replace(/\\/g, "/")).join("\n"), "utf8");
        }
        const merkle = await merkleBuild(workspacePath);
        const allFilesAbs = await readEmbeddableFilesList(workspacePath, defaultListPath);
        if (allFilesAbs.length === 0) {
            throw new Error("embeddableFilesPath yielded empty file list");
        }
        const filtered = allFilesAbs.filter((abs) => {
            try {
                const s = fs.statSync(abs);
                return s.isFile() && s.size <= DEFAULTS.FILE_SIZE_LIMIT_BYTES;
            }
            catch {
                return false;
            }
        });
        const batches = chunkArray(filtered, DEFAULTS.INITIAL_UPLOAD_MAX_FILES);
        // Use stable repoName for consistent server mapping; persist it in state
        const repoName = st.repoName || `local-${crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 12)}`;
        // perform a full cycle per batch: handshake -> upload -> ensure -> sync complete
        const encryptedToPlainPath = {};
        let totalUploaded = 0;
        const uploadedFilesVerbose = [];
        let lastCodebaseId = st.codebaseId;
        for (const batch of batches) {
            const { codebaseId, repositoryPb, simhash, pathKeyHash } = await initialHandshake(merkle, { ...st, workspacePath, orthogonalTransformSeed: st.orthogonalTransformSeed }, pathKey, ctx.baseUrl, ctx.authToken, repoName);
            // upload chunk
            totalUploaded += await uploadFilesChunk(batch, workspacePath, scheme, st.orthogonalTransformSeed, codebaseId, ctx.baseUrl, ctx.authToken, encryptedToPlainPath);
            if (params.verbose) {
                for (const abs of batch) {
                    const rel = path.relative(workspacePath, abs).replace(/\\/g, "/");
                    uploadedFilesVerbose.push(rel === "" ? "." : rel);
                }
            }
            // ensure + sync complete for this chunk
            await runEnsureAndSyncComplete(ctx.baseUrl, ctx.authToken, repositoryPb, codebaseId, simhash, pathKeyHash);
            lastCodebaseId = codebaseId;
            setRuntimeCodebaseId(workspacePath, codebaseId);
        }
        st = {
            ...st,
            workspacePath,
            pathKey,
            codebaseId: lastCodebaseId,
            repoName,
            repoOwner: st.repoOwner || "local-user",
            pendingChanges: false,
        };
        await saveWorkspaceState(st);
        // start watcher and schedule auto-sync
        if (!startedWatchers.has(workspacePath)) {
            startFileWatcher(workspacePath);
            startedWatchers.add(workspacePath);
        }
        if (!scheduled.has(workspacePath)) {
            scheduleAutoSync(workspacePath);
            scheduled.add(workspacePath);
        }
        const base = { codebaseId: lastCodebaseId, uploaded: totalUploaded, batches: batches.length, nextSyncAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
        if (params.verbose)
            base.files = uploadedFilesVerbose;
        return base;
    }
    async function autoSyncIfNeeded(workspacePath) {
        const st = await loadWorkspaceState(workspacePath);
        const runtimeId = getRuntimeCodebaseId(workspacePath) || st.codebaseId;
        if (!runtimeId || !st.pathKey || !st.orthogonalTransformSeed)
            return;
        // Prime runtime cache if needed
        if (!getRuntimeCodebaseId(workspacePath) && runtimeId)
            setRuntimeCodebaseId(workspacePath, runtimeId);
        const merkle = await merkleBuild(workspacePath);
        if (!st.pendingChanges)
            return;
        const scheme = new V1MasterKeyedEncryptionScheme(st.pathKey);
        const changed = await incrementalSync(workspacePath, merkle, runtimeId, scheme, ctx.baseUrl, ctx.authToken, st.orthogonalTransformSeed);
        if (changed.length === 0)
            return;
        // upload changed files
        await uploadFilesChunk(changed.map((rp) => path.join(workspacePath, rp)), workspacePath, scheme, st.orthogonalTransformSeed, runtimeId, ctx.baseUrl, ctx.authToken, {});
        const pathKeyHash = sha256Hex(st.pathKey);
        const simhash = Array.from(await merkle.getSimhash()).map((n) => Number(n));
        const repositoryPb = createRepositoryPb(workspacePath, st.orthogonalTransformSeed, st.repoName || `local-${crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 12)}`);
        await runEnsureAndSyncComplete(ctx.baseUrl, ctx.authToken, repositoryPb, runtimeId, simhash, pathKeyHash);
        st.pendingChanges = false;
        await saveWorkspaceState(st);
    }
    function scheduleAutoSync(workspacePath) {
        setInterval(() => { void autoSyncIfNeeded(workspacePath); }, DEFAULTS.AUTO_SYNC_INTERVAL_MS);
    }
    return { indexProject, autoSyncIfNeeded, scheduleAutoSync };
}
//# sourceMappingURL=repositoryIndexer.js.map