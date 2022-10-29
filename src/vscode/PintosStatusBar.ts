import EventEmitter = require("events")
import * as vscode from "vscode"
import { waitForEach } from "../core/utils/fp/common"
import { Config } from "./config"
import { PintosBuildDirsWatcher } from "./PintosBuildDirsWatcher"
import { uriFromCurrentWorkspace } from "./utils"

export default class PintosStatusBar implements vscode.Disposable {
  private readonly disposables: Array<vscode.Disposable> = []
  private readonly phasesGradeStatusItem: { [phase: string]: vscode.StatusBarItem } = {}
  private phasesLabels: { [phase: string]: string } = {}

  private constructor (
    phases: readonly string[]
  ) {
    phases.forEach(phase => this.phasesLabels[phase] = `${phase.substring(0, 2).toUpperCase()}`)
  }

  static async create (descriptor: {
    buildDirsFsWatcher: PintosBuildDirsWatcher
    phases: readonly string[]
  }) {
    const statusBar = new PintosStatusBar(descriptor.phases)

    const gradeWatcher = await PintosGradeFsWatcher.create(descriptor)
    statusBar.disposables.push(gradeWatcher)

    gradeWatcher.on("gradeStatus", (phase, request) => statusBar.gradeHandler(phase, request))
    Object.entries(gradeWatcher.currentGrades).forEach(
      ([phase, results]) => {
        statusBar.updateGradeStatusItem(phase, results)
      }
    )

    return statusBar
  }

  gradeHandler (phase: string, request: WatcherRequest) {
    switch (request.type) {
      case "remove":
        this.phasesGradeStatusItem[phase].dispose()
        delete this.phasesGradeStatusItem[phase]
        break
      case "update":
        this.updateGradeStatusItem(phase, request)
        break
      default:
        throw new Error("Watcher Request for grade status item is not supported")
    }
  }

  updateGradeStatusItem (phase: string, request: { grade: number }) {
    const item = this.phasesGradeStatusItem[phase] || vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1000
    )

    item.text = `${this.phasesLabels[phase]} ${request.grade.toFixed(1)}%`
    item.command = {
      command: "pintos.openGradeFileOf",
      title: "open grade file",
      arguments: [
        uriFromCurrentWorkspace(phase, "build", "grade")
      ]
    }

    item.tooltip = `Open grade of ${phase}`

    item.show()

    this.phasesGradeStatusItem[phase] = item
  }

  dispose() {
    this.disposables.concat(Object.values(this.phasesGradeStatusItem)).forEach(d => d.dispose())
  }
}

class PintosGradeFsWatcher extends EventEmitter implements vscode.Disposable {
  private readonly disposables: Array<vscode.Disposable> = []
  private readonly _currentGrades: {
    [phase: string]: { total: number, grade: number }
  } = {}

  public get currentGrades (): Readonly<typeof this._currentGrades> {
    return this._currentGrades
  }

  private constructor (
    private readonly phases: readonly string[],
    buildDirsFsWatcher: PintosBuildDirsWatcher
  ) {
    super()
    buildDirsFsWatcher.on("deleted", phase => this.emit("gradeStatus", phase, { type: "remove" }))
  }

  static async create ({ buildDirsFsWatcher, phases }: { phases: readonly string[], buildDirsFsWatcher: PintosBuildDirsWatcher }) {
    const watcher = new PintosGradeFsWatcher(phases, buildDirsFsWatcher)
    await watcher.watch()
    return watcher
  }

  private async watch () {
    await waitForEach(async (phase) => {
      const uri = uriFromCurrentWorkspace(phase, "build")

      const currentGrade = await this.parseGradeFromFs(vscode.Uri.joinPath(uri, "grade"))

      if (currentGrade) {
        this._currentGrades[phase] = currentGrade
      }

      const pattern = new vscode.RelativePattern(uri, "grade")
      const watcher = vscode.workspace.createFileSystemWatcher(pattern)

      const notifyUpdate = async (uri: vscode.Uri) => {
        const results = await this.parseGradeFromFs(uri)
        if (results) {
          this.emit("gradeStatus", phase, {
            type: "update",
            ...results
          })
        }
      }

      watcher.onDidChange(notifyUpdate)
      watcher.onDidDelete(() => {
        this.emit("gradeStatus", phase, { type: "remove" })
      })

      this.disposables.push(watcher)
    }, this.phases)

  }

  async parseGradeFromFs (uri: vscode.Uri): Promise<{ grade: number, total: number } | undefined> {
    let filedata

    try {
      filedata = await vscode.workspace.fs.readFile(uri)
    } catch {
      return
    }

    const content = filedata.toString()
    const matches = Config.pintosGradeRegex.exec(content)?.groups

    if (matches) {
      return {
        grade: parseFloat(matches.grade),
        total: parseFloat(matches.total)
      }
    }

    return undefined
  }

  dispose() {
    this.removeAllListeners()
    this.disposables.forEach(d => d.dispose())
  }
}

declare interface PintosGradeFsWatcher {
  on (event: WatcherEvent, listener: (phase: string, request: WatcherRequest) => void): this
  off (event: WatcherEvent, listener: (phase: string, request: WatcherRequest) => void): this
  emit (event: WatcherEvent, phase: string, request: WatcherRequest): boolean
}

type WatcherRequest = { type: "remove" } | { type: "update", grade: number, total: number }

type WatcherEvent = "gradeStatus"
