## Cometix Indexer（MCP 服务器）

语义代码搜索的本地索引与检索服务。该项目实现了一个基于 Model Context Protocol（MCP）的服务端，封装了对 Cursor 后端 RepositoryService 的建库、同步与搜索流程，通过两类 MCP 工具对外提供能力：项目索引（index_project）与语义搜索（codebase_search）。

### TODOs
- [x]  Cursor Indexing(ok)
- [ ] Warp Embedding
- [ ] Trae Indexing
- [ ] Augment Indexing
- [ ] Github Indexing(来源Copilot Indexing)

### 功能概述
- 索引：扫描本地工作区、生成文件清单、分批上传至 Cursor 服务端并完成建库标记。
- 增量同步：监听文件变更，按需进行轻量同步，保证搜索前的索引新鲜度。
- 语义搜索：调用远端检索接口并自动解密返回的加密路径，直观展示命中。
- 运行形态：作为 MCP 服务器通过 stdio 运行并响应工具调用。

## MCP
### Claude Code
#### npx格式
```
{
  "mcpServers": {
    "cometix-indexer": {
      "command": "npx",
      "args": [
        "-y",
        "--package=git+https://github.com/CometixAI/Cometix-Indexer.git",
        "cometix-indexer",
        "start"
      ],
      "env": {
        "CURSOR_AUTH_TOKEN": "",
        "CURSOR_BASE_URL": "https://api2.cursor.sh"
      }
    }
  }
}
````

#### npm格式(Local)
```
{
  "mcpServers": {
    "cometix-indexer": {
      "command": "npm",
      "args": [
        "--prefix",
        "<path>",
        "run",
        "start"
      ],
      "env": {
        "CURSOR_AUTH_TOKEN": "",
        "CURSOR_BASE_URL": "https://api2.cursor.sh"
      }
    }
  }
}
```

### MCP 工具

#### 1. `index_project` - 索引代码库（异步，立即返回）
**入参：**
- `workspacePath: string` - 必需，项目路径
- `verbose?: boolean` - 可选，是否返回详细文件列表
- `rescan?: boolean` - 可选，**仅在 .gitignore 修改后使用**，强制重新扫描

**行为：**
- 在后台启动索引，立即返回（避免 60s 超时）
- 首次索引：自动扫描并遵守 .gitignore 规则
- 再次索引：使用缓存的文件列表（更快）
- `rescan=true`：强制重新扫描，应用最新的 .gitignore（仅在 .gitignore 修改后需要）

**返回：**
```json
{
  "status": "started",
  "estimatedTime": "~45 seconds",
  "estimatedCompletionAt": "2025-10-31T10:30:00.000Z",
  "instructions": ["使用 index_status 监控进度"]
}
```

**预计时间（已优化：500文件/批，并发16）：**
- < 100 文件：~10 秒（1批）
- 100-500 文件：~12 秒（1批）
- 500-1000 文件：~15-20 秒（2批）
- 1000-1500 文件：~25-30 秒（3批）
- 1500-2000 文件：~30-40 秒（4批）

**性能提升：** 批次大小从 100 → 500，速度提升约 **3-5倍** 🚀

**计算公式：** `总时间 = 3秒(初始化) + 2秒(扫描) + (批次数 × 6秒) + 15%安全余量`

#### 2. `index_status` - 查询索引进度
**入参：**
- `workspacePath: string` - 必需，项目路径

**行为：**
- 查询实时索引进度
- 返回状态、进度百分比、预计完成时间
- 建议每 5-10 秒轮询一次

**返回：**
```json
{
  "status": "uploading",
  "message": "Uploading batch 5/10 (50% complete)",
  "currentBatch": 5,
  "totalBatches": 10,
  "uploadedFiles": 250,
  "totalFiles": 500,
  "estimatedCompletion": "2025-10-31T10:30:00.000Z"
}
```

**状态值：**
- `idle` - 未开始或已完成
- `scanning` - 正在扫描工作区
- `uploading` - 正在上传文件
- `completed` - 索引完成
- `error` - 索引失败

#### 3. `codebase_search` - 语义搜索
**入参：**
- `query: string` - **必需**，搜索查询（自然语言描述）
- `workspacePath: string` - **必需**，要搜索的工作区路径（必须与 index_project 使用的路径一致）
- `paths_include_glob?: string` - 可选，包含文件模式（如 `src/**/*.ts`）
- `paths_exclude_glob?: string` - 可选，排除文件模式（如 `**/*.test.ts`）
- `max_results?: number` - 可选，最大结果数（默认 10）

**行为：**
- 在指定的已索引工作区内搜索
- 搜索前自动进行增量同步（如有文件变更）
- 支持 glob 模式过滤结果
- **注意**：`workspacePath` 必须与调用 `index_project` 时使用的路径完全一致

**返回：**
```json
{
  "total": 15,
  "hits": [
    {
      "path": "src/auth/middleware.ts",
      "score": 0.92,
      "startLine": 15,
      "endLine": 28
    }
  ]
}
```

### 使用示例

**异步工作流程（推荐）：**
```javascript
// 步骤 1: 开始索引
const indexResult = index_project({ 
  workspacePath: "/Users/saner/Code/meiyi/scm-mq",
  rescan: false  // 首次索引或 .gitignore 未变化
})
// 立即返回: 
// {
//   status: "started",
//   estimatedTime: "45 seconds",  // 根据文件数量计算
//   nextStep: "Wait 45 seconds, then call index_status to verify completion"
// }

// 步骤 2: ⏰ 等待预计时间（重要！）
// 👉 根据返回的 estimatedTime 等待，例如 45 秒
// 不要立即查询 - 让索引在后台完成

// 步骤 3: 预计时间到达后，检查是否完成
index_status({ 
  workspacePath: "/Users/saner/Code/meiyi/scm-mq" 
})
// 返回: 
// - 如果完成: { status: "completed", message: "Indexing complete! Uploaded 289 files" }
// - 如果还在进行: { status: "uploading", currentBatch: 8, totalBatches: 10, message: "80% complete" }

// 步骤 4: 如果还未完成，等待 10 秒后再次检查
// （再等待 10 秒）
index_status({ workspacePath: "/Users/saner/Code/meiyi/scm-mq" })

// 步骤 5: 完成后开始搜索
codebase_search({
  query: "user authentication flow",
  workspacePath: "/Users/saner/Code/meiyi/scm-mq",  // 必需，必须与 index_project 的路径一致
  max_results: 10
})
```

**多工作区场景：**
```javascript
// 索引多个项目
index_project({ workspacePath: "/path/to/project1" })
index_project({ workspacePath: "/path/to/project2" })

// 搜索时指定要搜索的工作区（必需）
codebase_search({
  query: "authentication",
  workspacePath: "/path/to/project1"  // 必需参数
})

codebase_search({
  query: "payment processing", 
  workspacePath: "/path/to/project2"  // 搜索不同的项目
})
```

**如果修改了 .gitignore：**
```javascript
// 使用 rescan=true 重新扫描
index_project({ 
  workspacePath: "/Users/saner/Code/meiyi/scm-mq",
  rescan: true  // 👈 应用新的 .gitignore 规则
})
```

### 目录结构（核心）
- `src/index.ts`：进程入口。解析 CLI/环境变量，创建 MCP `Server` 并接入 stdio 传输。
- `src/server.ts`：注册 MCP 工具：`index_project` 与 `codebase_search`。
- `src/services/repositoryIndexer.ts`：索引与同步核心逻辑（初次建库、分批上传、增量同步、定时器）。
- `src/services/codeSearcher.ts`：搜索逻辑（预同步、远端搜索、结果解密与规整）。
- `src/services/fileWatcher.ts`：文件变更监听，标记 `pendingChanges`。
- `src/services/stateManager.ts`：工作区状态持久化（`state.json`）。
- `src/crypto/pathEncryption.ts`：路径分段加解密方案与 Windows/Posix 互转。
- `src/client/proto.ts`：加载 `proto/repository_service.proto` 并以 protobuf 编解码发送 HTTP 请求。
- `src/client/cursorApi.ts`：封装调用的具体 RepositoryService 接口。
- `src/utils/env.ts`：配置解析、默认参数与请求头。
- `src/utils/fs.ts`：忽略规则、文件遍历与可嵌入文件清单读取。
- `src/utils/semaphore.ts`：并发控制与带重试的信号量。

### 工作原理
1) 初次索引
- 扫描工作区（忽略 `node_modules/`、`.git/`、`dist/` 等）并生成默认清单 `embeddable_files.txt`（每个工作区独立存放）。
- 基于 `@anysphere/file-service` 的 `MerkleClient` 构建目录 Merkle 树，获取 `rootHash` 与 `simhash`。
- 生成路径加密密钥（`pathKey`），并以 `V1MasterKeyedEncryptionScheme` 对相对路径逐段加密。
- 将文件按批（`INITIAL_UPLOAD_MAX_FILES`）执行完整流程：
  - `FastRepoInitHandshakeV2` 握手（返回 `codebaseId`）。
  - 上传本批文件（`FastUpdateFileV2`）。
  - `EnsureIndexCreated` 与 `FastRepoSyncComplete` 标记索引完成。
- 将 `codebaseId`、`pathKey`、`orthogonalTransformSeed` 等持久化到工作区状态 `state.json`。

2) 增量同步
- `chokidar` 监听文件变更，只标记 `pendingChanges = true`（轻量）。
- 搜索或定时器触发时，如存在变更：
  - 使用 `SyncMerkleSubtreeV2` 对目录节点进行比对，定位不匹配的子树与文件。
  - 对变更文件执行同批上传与 `EnsureIndexCreated`/`FastRepoSyncComplete`。
  - 清理 `pendingChanges` 标记并持久化。

3) 语义搜索
- 搜索前先触发一次按需增量同步以保证结果新鲜。
- 调用 `SearchRepositoryV2` 并对返回的加密路径用本地 `pathKey` 解密为 Posix 相对路径，输出 `{ path, score, startLine, endLine }`。

### 运行要求
- Node.js >= 18
- `proto/repository_service.proto` 必须存在（仓库已附带）。

### 启动（npx）
```bash
npx -y --package=git+https://github.com/CometixAI/Cometix-Indexer.git cometix-indexer -- --auth-token "$CURSOR_AUTH_TOKEN" --base-url https://api2.cursor.sh
```

### 启动（npm scripts）
```bash
# 安装依赖并构建
npm install
npm run build

# 方式一：通过环境变量（PowerShell 示例）
$env:CURSOR_AUTH_TOKEN="你的Token"; npm run start

# 方式二：通过参数传递（-- 之后的参数会透传给脚本）
npm run start -- --auth-token 你的Token --base-url https://api2.cursor.sh --log-level info

# 开发模式（监听编译；运行需要另开终端执行 start）
npm run dev
# 另开一个终端
npm run start -- --auth-token 你的Token
```
可用环境变量：
- `CURSOR_AUTH_TOKEN`（必需）
- `CURSOR_BASE_URL`（默认 `https://api2.cursor.sh`）
- `LOG_LEVEL`（`debug` | `info` | `warning` | `error`，默认 `info`）
- `COMETIX_LOG_FILE`（可选，指定日志文件路径，如 `/tmp/cometix-indexer.log`）

### 查看日志与调试

#### 方法 1: 查看 Cursor/Claude Desktop 的 MCP 日志
MCP 服务器的输出会被记录到 Cursor 或 Claude Desktop 的日志中：

**Cursor:**
- macOS: `~/Library/Logs/Cursor/`
- Windows: `%APPDATA%\Cursor\logs\`
- Linux: `~/.config/Cursor/logs/`

**Claude Desktop:**
- macOS: `~/Library/Logs/Claude/`
- Windows: `%APPDATA%\Claude\logs\`
- Linux: `~/.config/Claude/logs/`

查看最新日志：
```bash
# macOS (Cursor)
tail -f ~/Library/Logs/Cursor/main.log

# macOS (Claude Desktop)  
tail -f ~/Library/Logs/Claude/mcp*.log
```

#### 方法 2: 使用日志文件（推荐用于调试）
在 MCP 配置中添加 `COMETIX_LOG_FILE` 环境变量：

```json
{
  "mcpServers": {
    "cometix-indexer": {
      "command": "npx",
      "args": ["-y", "--package=git+https://github.com/CometixAI/Cometix-Indexer.git", "cometix-indexer", "start"],
      "env": {
        "CURSOR_AUTH_TOKEN": "your-token",
        "CURSOR_BASE_URL": "https://api2.cursor.sh",
        "COMETIX_LOG_FILE": "/tmp/cometix-indexer.log"
      }
    }
  }
}
```

然后实时查看日志：
```bash
tail -f /tmp/cometix-indexer.log
```

#### 方法 3: 独立测试运行
直接在命令行运行以查看即时输出：
```bash
# 使用 npx
CURSOR_AUTH_TOKEN="your-token" COMETIX_LOG_FILE="/tmp/cometix.log" \
  npx -y --package=git+https://github.com/CometixAI/Cometix-Indexer.git cometix-indexer start

# 本地开发
CURSOR_AUTH_TOKEN="your-token" npm run start
```

日志会输出到 stderr，包含：
- 启动信息（版本、配置等）
- MCP 服务器初始化过程
- 错误和异常堆栈信息

### 环境变量与默认值（可调优）

**性能优化参数（已激进优化，异步执行无超时限制）：**
- `INITIAL_UPLOAD_MAX_FILES`（默认 **500** ⚡，初次索引分批大小）
  - 更大批次 = 更少网络往返 = 更快速度
  - 1000文件：2批（vs 旧版10批）→ **快5倍**
  - 对于超大代码库（> 2000 文件），可设置为 1000
  - 示例：`export INITIAL_UPLOAD_MAX_FILES=1000`
- `SYNC_CONCURRENCY`（默认 **16** ⚡，并发线程数）
  - 更高并发 = 更快文件处理
  - 已从 4 → 8 → 16 优化
  - 可进一步增加到 32（如果网络带宽充足）
- `PROTO_TIMEOUT_MS`（默认 **120000** = 2分钟）
  - 支持大批次（500文件）的上传
  - 如果批次 > 500，建议增加到 180000（3分钟）
- `FILE_SIZE_LIMIT_BYTES`（默认 **5MB**，从 2MB 提升）
  - 可索引更大的文件
- `SYNC_LIST_LIMIT`（默认 **2000**，从 1000 提升）
  - 支持更大的代码库

**其他配置：**
- `SYNC_MAX_NODES`（默认 2000）
- `SYNC_MAX_ITERATIONS`（默认 10000）
- `PROTO_SEARCH_TIMEOUT_MS`（默认 60000 = 1分钟）
- `AUTO_SYNC_INTERVAL_MS`（默认 5 分钟）

**实际索引时间（优化后，比旧版快 3-5 倍）：**
- 小型项目（< 100 文件）：~10 秒 ⚡
- 中型项目（100-500 文件）：~12 秒 ⚡（旧版需 20-40秒）
- 大型项目（500-1000 文件）：~15-20 秒 ⚡（旧版需 1-2分钟）
- 超大项目（1000-2000 文件）：~25-40 秒 ⚡（旧版需 2-4分钟）

💡 **性能对比**：
- 1000文件：从 10批(40s) → 2批(17s) = **快 60%**
- 500文件：从 5批(25s) → 1批(11s) = **快 56%**

💡 **提示**：返回的 `estimatedTime` 已根据优化调整，等待该时间后再调用 `index_status` 验证完成

### 开发安装与构建
```bash
npm install
npm run build
```

### 状态与数据持久化
- 工作区专属数据目录：`%USERPROFILE%/.cometix/cursor-indexer/<safeName>-<hash>/`
  - `state.json`：保存 `codebaseId`、`pathKey`、`orthogonalTransformSeed` 等。
  - `embeddable_files.txt`：首次索引生成的可嵌入文件列表，可手动编辑以精确控制索引范围。

### 路径加密与兼容性
- 采用分段对称加密（`aes-256-ctr`）并在 Windows 相对路径（以 `./` 或 `.\` 起始）层面进行，避免泄露真实目录结构。
- 搜索结果会自动尝试使用本地 `pathKey` 解密为 Posix 相对路径，失败时回退为原始加密串。

### 忽略与限制

**自动 .gitignore 支持：**
- 🎯 **自动读取项目根目录的 `.gitignore` 文件**
- 完全兼容 gitignore 语法（支持 `!` 排除、`**` 通配符等）
- 尊重用户的忽略规则，不会强制覆盖
- 提升索引速度，避免索引不需要的文件

**最小默认忽略规则（仅 6 个，确保安全和性能）：**
- `node_modules/` - 依赖包（太大，可重新生成）
- `.git/` - Git 内部数据（二进制，无索引价值）
- `.DS_Store`、`Thumbs.db` - 系统元数据（二进制）
- `.env`、`.env.*` - 环境变量（可能包含密钥）

**✨ 设计理念：**
- 默认规则只包含**绝对必要**的忽略项（安全、性能）
- 其他所有规则通过项目的 `.gitignore` 控制
- 如果你想索引 `dist/` 或 `build/`，只需不在 `.gitignore` 中添加它们

**文件大小限制：**
- 超过 `FILE_SIZE_LIMIT_BYTES`（默认 2MB）的文件会被跳过

**示例 .gitignore 用法：**
```gitignore
# 构建输出
/dist/
/build/

# 日志文件
*.log
!important.log  # 但保留这个

# 临时文件
/tmp/
*.tmp

# 测试文件
**/*.test.js
**/__tests__/

# IDE 配置
.vscode/
.idea/
```

### 常见问题
- 报错 `repository_service.proto not found`：请确认项目根目录存在 `proto/repository_service.proto`。
- `Missing CURSOR_AUTH_TOKEN`：通过 `--auth-token` 传参或设置环境变量 `CURSOR_AUTH_TOKEN`。

### 许可
MIT


