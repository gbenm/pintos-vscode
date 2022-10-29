import * as vscode from "vscode"
import { EventEmitter } from "node:events"
import { uriFromCurrentWorkspace } from "./utils"

export class PintosBuildDirsWatcher extends EventEmitter implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []

  constructor (private readonly phases: string[]) {
    super()
    this.watchBuildDirs()
  }

  private watchBuildDirs() {
    this.phases.forEach(phase => {
      const uri = uriFromCurrentWorkspace(phase)
      const pattern = new vscode.RelativePattern(uri, "build")
      const watcher = vscode.workspace.createFileSystemWatcher(pattern, true, true)

      watcher.onDidDelete(() => this.emit("deleted", phase))

      this.disposables.push(watcher)
    })
  }

  dispose() {
    this.removeAllListeners()
    this.disposables.forEach(d => d.dispose())
  }
}

export declare interface PintosBuildDirsWatcher {
  on (event: WatcherEvent, listener: (phase: string) => void): this
  off (event: WatcherEvent, listener: (phase: string) => void): this
}

export type WatcherEvent = "deleted"
