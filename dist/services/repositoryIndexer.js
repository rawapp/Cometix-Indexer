import path from "path";
import fs from "fs-extra";
import crypto from "crypto";
import { MerkleClient } from "@anysphere/file-service";
import { DEFAULTS } from "../utils/env.js";
import { listFiles, readEmbeddableFilesList, shouldIgnore, clearGitignoreCache } from "../utils/fs.js";
import { Semaphore } from "../utils/semaphore.js";
import { V1MasterKeyedEncryptionScheme, decryptPathToRelPosix, encryptPathWindows, genPathKey, sha256Hex } from "../crypto/pathEncryption.js";
import { ensureIndexCreated, fastRepoInitHandshakeV2, fastRepoSyncComplete, fastUpdateFileV2, syncMerkleSubtreeV2 } from "../client/cursorApi.js";
import { loadWorkspaceState, saveWorkspaceState, setRuntimeCodebaseId, getRuntimeCodebaseId, setIndexingProgress, getIndexingProgress } from "./stateManager.js";
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
    /**
     * Estimate indexing time based on file count and batch size
     * With optimized settings (batch size 500, concurrency 16):
     * - Scanning: ~2-3 seconds for most projects
     * - Per batch (500 files): ~5-8 seconds (handshake + upload + ensure + sync)
     * - Overhead: ~3 seconds initial setup
     */
    function estimateIndexingTime(fileCount) {
        const batchSize = DEFAULTS.INITIAL_UPLOAD_MAX_FILES;
        const batches = Math.ceil(fileCount / batchSize);
        // Optimized timing with larger batches (500 files per batch)
        const scanningTime = 2; // File scanning (faster with concurrency 16)
        const secondsPerBatch = 6; // Larger batches take a bit longer per batch
        const overhead = 3; // Initial setup (reduced)
        const totalSeconds = overhead + scanningTime + (batches * secondsPerBatch);
        // Add 15% safety margin (reduced from 20% due to more consistent large batches)
        const safeSeconds = Math.ceil(totalSeconds * 1.15);
        let description = "";
        let whenToCheck = "";
        if (safeSeconds < 30) {
            description = `${safeSeconds} seconds`;
            whenToCheck = `${safeSeconds} seconds`;
        }
        else if (safeSeconds < 120) {
            const minutes = Math.ceil(safeSeconds / 60);
            description = `${minutes} minute${minutes > 1 ? 's' : ''}`;
            whenToCheck = `${minutes} minute${minutes > 1 ? 's' : ''}`;
        }
        else {
            const minutes = Math.ceil(safeSeconds / 60);
            description = `${minutes} minutes`;
            whenToCheck = `${minutes} minutes`;
        }
        return { seconds: safeSeconds, description, whenToCheck };
    }
    async function indexProject(params) {
        const workspacePath = path.resolve(params.workspacePath);
        console.error(`[INDEX] Starting indexing for: ${workspacePath}`);
        if (params.rescan) {
            console.error(`[INDEX] Rescan mode enabled - will re-scan workspace with latest .gitignore`);
            // Clear gitignore cache to reload .gitignore file
            clearGitignoreCache(workspacePath);
        }
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
        const fileListExists = await fs.pathExists(defaultListPath);
        const needsScan = !fileListExists || params.rescan;
        if (needsScan) {
            if (params.rescan && fileListExists) {
                console.error(`[INDEX] Rescan requested - deleting existing file list`);
                await fs.remove(defaultListPath);
            }
            setIndexingProgress(workspacePath, {
                status: "scanning",
                message: "Scanning workspace for files...",
                startedAt: new Date().toISOString(),
            });
            console.error(`[INDEX] Scanning workspace for files (limit: ${DEFAULTS.SYNC_LIST_LIMIT})...`);
            const discovered = await listFiles(workspacePath, DEFAULTS.SYNC_LIST_LIMIT);
            console.error(`[INDEX] Created file list with ${discovered.length} files at: ${defaultListPath}`);
            await fs.writeFile(defaultListPath, discovered.map((p) => path.relative(workspacePath, p).replace(/\\/g, "/")).join("\n"), "utf8");
        }
        else {
            console.error(`[INDEX] Using existing file list: ${defaultListPath}`);
            console.error(`[INDEX] Tip: To rescan with .gitignore, call with rescan: true`);
        }
        console.error(`[INDEX] Building Merkle tree...`);
        const merkle = await merkleBuild(workspacePath);
        console.error(`[INDEX] Reading embeddable files list...`);
        const allFilesAbs = await readEmbeddableFilesList(workspacePath, defaultListPath);
        if (allFilesAbs.length === 0) {
            throw new Error("embeddableFilesPath yielded empty file list");
        }
        console.error(`[INDEX] File list contains ${allFilesAbs.length} files`);
        console.error(`[INDEX] Filtering by size (max: ${Math.round(DEFAULTS.FILE_SIZE_LIMIT_BYTES / 1024)}KB)...`);
        const filtered = [];
        const skippedFiles = [];
        for (const abs of allFilesAbs) {
            try {
                const s = fs.statSync(abs);
                if (s.isFile()) {
                    if (s.size <= DEFAULTS.FILE_SIZE_LIMIT_BYTES) {
                        filtered.push(abs);
                    }
                    else {
                        skippedFiles.push({
                            path: path.relative(workspacePath, abs),
                            size: s.size
                        });
                    }
                }
            }
            catch {
                // File doesn't exist or not accessible
            }
        }
        if (skippedFiles.length > 0) {
            console.error(`[INDEX] Skipped ${skippedFiles.length} files exceeding ${Math.round(DEFAULTS.FILE_SIZE_LIMIT_BYTES / 1024)}KB limit:`);
            skippedFiles.slice(0, 5).forEach(f => {
                console.error(`[INDEX]   - ${f.path} (${Math.round(f.size / 1024)}KB)`);
            });
            if (skippedFiles.length > 5) {
                console.error(`[INDEX]   ... and ${skippedFiles.length - 5} more large files`);
            }
        }
        const batches = chunkArray(filtered, DEFAULTS.INITIAL_UPLOAD_MAX_FILES);
        console.error(`[INDEX] Will upload ${filtered.length} files in ${batches.length} batches (${DEFAULTS.INITIAL_UPLOAD_MAX_FILES} files per batch)`);
        // Calculate estimated time
        const estimate = estimateIndexingTime(filtered.length);
        const estimatedCompletion = new Date(Date.now() + estimate.seconds * 1000).toISOString();
        console.error(`[INDEX] Estimated time: ${estimate.description} (${batches.length} batches × ~2s/batch + overhead)`);
        // Set initial progress
        setIndexingProgress(workspacePath, {
            status: "uploading",
            message: `Uploading ${filtered.length} files in ${batches.length} batches`,
            currentBatch: 0,
            totalBatches: batches.length,
            uploadedFiles: 0,
            totalFiles: filtered.length,
            startedAt: new Date().toISOString(),
            estimatedCompletion,
        });
        // Use stable repoName for consistent server mapping; persist it in state
        const repoName = st.repoName || `local-${crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 12)}`;
        // perform a full cycle per batch: handshake -> upload -> ensure -> sync complete
        const encryptedToPlainPath = {};
        let totalUploaded = 0;
        const uploadedFilesVerbose = [];
        let lastCodebaseId = st.codebaseId;
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.error(`[INDEX] Processing batch ${i + 1}/${batches.length} (${batch.length} files)...`);
            // Update progress
            const progressPercent = Math.round((i / batches.length) * 100);
            const remainingBatches = batches.length - i;
            const remainingSeconds = remainingBatches * 2; // ~2s per batch
            const newEstimatedCompletion = new Date(Date.now() + remainingSeconds * 1000).toISOString();
            setIndexingProgress(workspacePath, {
                status: "uploading",
                message: `Uploading batch ${i + 1}/${batches.length} (${progressPercent}% complete)`,
                currentBatch: i + 1,
                totalBatches: batches.length,
                uploadedFiles: totalUploaded,
                totalFiles: filtered.length,
                startedAt: new Date().toISOString(),
                estimatedCompletion: newEstimatedCompletion,
            });
            console.error(`[INDEX]   - Performing handshake...`);
            const { codebaseId, repositoryPb, simhash, pathKeyHash } = await initialHandshake(merkle, { ...st, workspacePath, orthogonalTransformSeed: st.orthogonalTransformSeed }, pathKey, ctx.baseUrl, ctx.authToken, repoName);
            // upload chunk
            console.error(`[INDEX]   - Uploading ${batch.length} files...`);
            const uploaded = await uploadFilesChunk(batch, workspacePath, scheme, st.orthogonalTransformSeed, codebaseId, ctx.baseUrl, ctx.authToken, encryptedToPlainPath);
            totalUploaded += uploaded;
            console.error(`[INDEX]   - Uploaded ${uploaded} files (total: ${totalUploaded}/${filtered.length})`);
            if (params.verbose) {
                for (const abs of batch) {
                    const rel = path.relative(workspacePath, abs).replace(/\\/g, "/");
                    uploadedFilesVerbose.push(rel === "" ? "." : rel);
                }
            }
            // ensure + sync complete for this chunk
            console.error(`[INDEX]   - Finalizing batch (ensure index + sync complete)...`);
            await runEnsureAndSyncComplete(ctx.baseUrl, ctx.authToken, repositoryPb, codebaseId, simhash, pathKeyHash);
            lastCodebaseId = codebaseId;
            setRuntimeCodebaseId(workspacePath, codebaseId);
            console.error(`[INDEX]   - Batch ${i + 1}/${batches.length} complete (${progressPercent}% done, ~${Math.round(remainingSeconds / 60)}min remaining)`);
        }
        console.error(`[INDEX] Saving workspace state...`);
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
            console.error(`[INDEX] Starting file watcher...`);
            startFileWatcher(workspacePath);
            startedWatchers.add(workspacePath);
        }
        if (!scheduled.has(workspacePath)) {
            console.error(`[INDEX] Scheduling auto-sync (every ${DEFAULTS.AUTO_SYNC_INTERVAL_MS / 1000 / 60} minutes)...`);
            scheduleAutoSync(workspacePath);
            scheduled.add(workspacePath);
        }
        console.error(`[INDEX] ✓ Indexing complete! CodebaseId: ${lastCodebaseId}, Uploaded: ${totalUploaded} files`);
        // Mark as completed
        setIndexingProgress(workspacePath, {
            status: "completed",
            message: `Indexing complete! Uploaded ${totalUploaded} files`,
            currentBatch: batches.length,
            totalBatches: batches.length,
            uploadedFiles: totalUploaded,
            totalFiles: filtered.length,
            startedAt: new Date().toISOString(),
        });
        const base = { codebaseId: lastCodebaseId, uploaded: totalUploaded, batches: batches.length, nextSyncAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
        if (params.verbose)
            base.files = uploadedFilesVerbose;
        return base;
    }
    // Async version that runs in background and returns estimated info immediately
    async function indexProjectAsync(params) {
        const workspacePath = path.resolve(params.workspacePath);
        // Quick scan to get file count for estimation
        const projectDir = (await import("./stateManager.js")).getWorkspaceProjectDir(workspacePath);
        const defaultListPath = path.join(projectDir, "embeddable_files.txt");
        let fileCount = 0;
        if (await fs.pathExists(defaultListPath) && !params.rescan) {
            // Read existing file list for quick estimate
            const content = await fs.readFile(defaultListPath, "utf8");
            fileCount = content.split('\n').filter(l => l.trim()).length;
        }
        else {
            // Estimate based on quick directory scan (just count, don't filter)
            try {
                const quickScan = await listFiles(workspacePath, 10);
                fileCount = quickScan.length; // This will trigger the scan anyway
            }
            catch {
                fileCount = 100; // Default estimate
            }
        }
        const estimate = estimateIndexingTime(fileCount);
        const estimatedCompletion = new Date(Date.now() + estimate.seconds * 1000).toISOString();
        // Set initial status
        setIndexingProgress(workspacePath, {
            status: "scanning",
            message: "Starting workspace scan...",
            totalFiles: fileCount,
            startedAt: new Date().toISOString(),
            estimatedCompletion,
        });
        // Run in background
        indexProject(params)
            .then(result => {
            console.error(`[BACKGROUND] Indexing completed for ${workspacePath}`);
            console.error(`[BACKGROUND] Result: ${JSON.stringify(result)}`);
        })
            .catch(error => {
            console.error(`[BACKGROUND] Indexing failed for ${workspacePath}:`, error);
            setIndexingProgress(workspacePath, {
                status: "error",
                message: "Indexing failed",
                error: error.message || String(error),
                startedAt: new Date().toISOString(),
            });
        });
        return {
            estimatedSeconds: estimate.seconds,
            estimatedDescription: estimate.description,
            estimatedCompletion,
            whenToCheck: estimate.whenToCheck,
        };
    }
    // Get indexing status
    async function getIndexStatus(workspacePath) {
        const resolvedPath = path.resolve(workspacePath);
        const progress = getIndexingProgress(resolvedPath);
        if (!progress) {
            // Check if already indexed
            const st = await loadWorkspaceState(resolvedPath);
            if (st.codebaseId) {
                return {
                    status: "idle",
                    message: "Workspace already indexed. Call index_project to re-index.",
                    totalFiles: 0,
                };
            }
            else {
                return {
                    status: "idle",
                    message: "Workspace not yet indexed. Call index_project to start.",
                    totalFiles: 0,
                };
            }
        }
        // Calculate progress percentage
        let progressPercent = 0;
        if (progress.totalBatches && progress.currentBatch) {
            progressPercent = Math.round((progress.currentBatch / progress.totalBatches) * 100);
        }
        return {
            ...progress,
            message: progress.message + ` (${progressPercent}%)`,
        };
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
    return {
        indexProject,
        indexProjectAsync,
        getIndexStatus,
        autoSyncIfNeeded,
        scheduleAutoSync
    };
}
//# sourceMappingURL=repositoryIndexer.js.map