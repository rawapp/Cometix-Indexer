import path from "path";
import fs from "fs-extra";
import ignore from "ignore";

const IGNORE_PATTERNS: string[] = [
  "node_modules/",
  ".git/",
  ".cursor/",
  "dist/",
  "build/",
  "/coverage/",
  "/.nyc_output/",
  ".DS_Store",
  "Thumbs.db",
  ".env",
  ".env.",
];

// Cache for gitignore instances per workspace
const gitignoreCache = new Map<string, ReturnType<typeof ignore>>();

function loadGitignore(workspacePath: string): ReturnType<typeof ignore> {
  if (gitignoreCache.has(workspacePath)) {
    return gitignoreCache.get(workspacePath)!;
  }

  const ig = ignore();
  
  // Always add default patterns
  ig.add(IGNORE_PATTERNS);

  // Try to load .gitignore file
  const gitignorePath = path.join(workspacePath, ".gitignore");
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf8");
      ig.add(content);
      console.error(`[FS] Loaded .gitignore from ${workspacePath} (${content.split('\n').filter(l => l.trim() && !l.startsWith('#')).length} patterns)`);
    } else {
      console.error(`[FS] No .gitignore found in ${workspacePath}, using default patterns only`);
    }
  } catch (error) {
    console.error(`[FS] Warning: Failed to load .gitignore:`, error);
  }

  gitignoreCache.set(workspacePath, ig);
  return ig;
}

export function shouldIgnore(fileAbs: string, workspacePath: string): boolean {
  const rel = path.relative(workspacePath, fileAbs).replace(/\\/g, "/");
  
  // Use gitignore for pattern matching
  const ig = loadGitignore(workspacePath);
  return ig.ignores(rel);
}

// Clear gitignore cache for a workspace (useful if .gitignore changes)
export function clearGitignoreCache(workspacePath?: string): void {
  if (workspacePath) {
    gitignoreCache.delete(workspacePath);
    console.error(`[FS] Cleared .gitignore cache for ${workspacePath}`);
  } else {
    gitignoreCache.clear();
    console.error(`[FS] Cleared all .gitignore caches`);
  }
}

export async function listFiles(workspacePath: string, limit = 1000): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (shouldIgnore(full, workspacePath)) continue;
      if (e.isDirectory()) {
        await walk(full);
        if (out.length >= limit) return;
      } else if (e.isFile()) {
        out.push(full);
        if (out.length >= limit) return;
      }
    }
  }
  await walk(workspacePath);
  return out;
}

export async function readEmbeddableFilesList(root: string, listPath: string): Promise<string[]> {
  const p = path.isAbsolute(listPath) ? listPath : path.join(root, listPath);
  try {
    const content = await fs.readFile(p, "utf8");
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      out.push(path.isAbsolute(t) ? t : path.join(root, t));
    }
    return out;
  } catch {
    return [];
  }
}


