import * as vscode from "vscode"
import { setStatusFromResultFile } from "../core/grade/run"
import { TestItem } from "../core/grade/TestItem"
import { iterableForEach } from "../core/utils/fp/common"
import { PintosBuildDirsWatcher } from "./PintosBuildDirsWatcher"
import { TestController, vsctestDescription } from "./PintosTestController"

export default class PintosTestsFsWatcher implements vscode.Disposable {
  public readonly folders: vscode.WorkspaceFolder[]

  private started = false
  private readonly disposables: vscode.Disposable[] = []
  private readonly controller: TestController
  private currentRefreshTimeout: NodeJS.Timeout | undefined
  private testsToUpdate: TestItem<vscode.TestItem>[] = []

  private backlessHandler = this.changeDescriptionOf.bind(this)
  private statusHandler = this.addToUpdateTests.bind(this)
  private renderKey = 0

  constructor (args: {
    folders: vscode.WorkspaceFolder[]
    controller: TestController
    buildDirsFsWatcher: PintosBuildDirsWatcher
  }) {
    this.folders = args.folders
    this.controller = args.controller
    this.subscribeToOnDeletedBuildDir(args.buildDirsFsWatcher)
  }

  private subscribeToOnDeletedBuildDir (buildDirsWatcher: PintosBuildDirsWatcher) {
    const onDeletedBuildDir = (phase: string) => {
      const test = this.controller.rootTests.find(test => test.phase === phase)
      if (test) {
        iterableForEach(child => child.backless = true, test.testLeafs)
      }
    }

    buildDirsWatcher.on("deleted", onDeletedBuildDir)
    this.disposables.push({
      dispose () {
        buildDirsWatcher.off("deleted", onDeletedBuildDir)
      }
    })
  }

  start () {
    if (this.started) {
      throw new Error("Watcher already started")
    }

    this.started = true

    this.controller.rootTests.forEach(test => {
      test.on("backless", this.backlessHandler)
      test.on("status", this.statusHandler)
    })

    this.watchResultFiles()
  }

  private watchResultFiles () {
    this.folders
      .forEach(folder => {
        if (!folder) {
          return null
        }

        const pattern = new vscode.RelativePattern(folder, "**/*.result")
        const watcher = vscode.workspace.createFileSystemWatcher(pattern)

        const changeStatusOfTest = (createEvent: boolean, { fsPath }: vscode.Uri) => {
          const test = this.controller.findTestByResultFile(fsPath)
          if (createEvent && test) {
            test.backless = false
          }

          if (test && !this.controller.isWithinActiveTestRunners(test.id)) {
            setStatusFromResultFile(test)
          }
        }

        const notifyResultFileDeletion = ({ fsPath }: vscode.Uri) => {
          const test = this.controller.findTestByResultFile(fsPath)
          if (test) {
            test.backless = true
            test.status = "unknown"
          }
        }

        watcher.onDidCreate((uri) => changeStatusOfTest(true, uri))
        watcher.onDidChange((uri) => changeStatusOfTest(false, uri))
        watcher.onDidDelete(notifyResultFileDeletion)

        this.disposables.push(watcher)
      })
  }

  public changeDescriptionOf (item: TestItem<vscode.TestItem>, backless: boolean) {
    const vsctest = item.data
    vsctest.description = (this.renderKey++).toString()
    vsctest.description = vsctestDescription(backless)
  }

  public addToUpdateTests (item: TestItem<vscode.TestItem>) {
    const active = this.controller.isWithinActiveTestRunners(item.gid)
    if (!item.isComposite && !active) {
      this.testsToUpdate.push(item)

      if (!this.currentRefreshTimeout) {
        this.currentRefreshTimeout = setTimeout(() => this.updateStatusTestsInUI(), 1000)
      }
    }
  }

  updateStatusTestsInUI () {
    const uiManager = this.controller.createTestLotUiManager({
      include: this.testsToUpdate.map(({ data }) => data)
    })
    uiManager.reflectCurrentTestsStatusInUI()
    uiManager.dispose()
    this.currentRefreshTimeout = undefined
  }

  dispose() {
    clearTimeout(this.currentRefreshTimeout)
    this.controller.rootTests.forEach(test => {
      test.off("backless", this.backlessHandler)
      test.off("status", this.statusHandler)
    })
    this.disposables.forEach(d => d.dispose())
  }
}
