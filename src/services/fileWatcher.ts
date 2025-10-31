import chokidar from "chokidar";
import { saveWorkspaceState, loadWorkspaceState } from "./stateManager.js";

export function startFileWatcher(workspacePath: string): void {
  const watcher = chokidar.watch(workspacePath, {
    ignored: [/(^|[\\/])\../, /node_modules/, /dist/, /build/, /.nyc_output/, /coverage/],
    persistent: true,
    ignoreInitial: true,
  });
  const markChanged = async () => {
    const st = await loadWorkspaceState(workspacePath);
    st.pendingChanges = true;
    await saveWorkspaceState(st);
  };
  watcher.on("add", markChanged);
  watcher.on("change", markChanged);
  watcher.on("unlink", markChanged);
}


