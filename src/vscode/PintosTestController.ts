import * as vscode from "vscode"
import { ensureLookupTestsInPhase } from "../core/grade/lookup"
import { TestItem, TestItemMapper, TestRunRequest, TestStatus } from "../core/grade/TestItem"
import { childProcessToPromise, scopedCommand, ScopedCommandExecutor } from "../core/launch"
import { getCurrentWorkspaceUri, pickOptions, showStopMessage, createScopedHandler, uriFromCurrentWorkspace } from "./utils"
import { generateTestId, getDirOfTest, getNameOfTest, onMissingDiscoverMakefile, onMissingTestDir, splitTestId } from "../core/grade/utils"
import { bind, iterableForEach, iterLikeTolist, prop, waitForEach, waitMap } from "../core/utils/fp/common"
import { OutputChannel } from "../core/types"
import { cleanAndCompilePhase } from "../core/grade/compile"
import { setStatusFromResultFile } from "../core/grade/run"
import { executeOrStopOnError } from "./errors"
import { existsSync } from "node:fs"
import { ChildProcessWithoutNullStreams } from "node:child_process"

export class TestController implements vscode.TestController, vscode.Disposable {
  protected vscTestController: vscode.TestController

  public get id () {
    return this.vscTestController.id
  }

  public get label () {
    return this.vscTestController.label
  }

  public get items () {
    return this.vscTestController.items
  }

  public createRunProfile: vscode.TestController["createRunProfile"]
  public createTestItem: vscode.TestController["createTestItem"]
  public createTestRun: vscode.TestController["createTestRun"]
  public refreshHandler: vscode.TestController["refreshHandler"]
  public resolveHandler: vscode.TestController["resolveHandler"]

  constructor () {
    this.vscTestController = vscode.tests.createTestController("pintos", "PintOS")
    this.createRunProfile = this.vscTestController.createRunProfile
    this.createTestItem = this.vscTestController.createTestItem
    this.createTestRun = this.vscTestController.createTestRun
    this.refreshHandler = this.vscTestController.refreshHandler
    this.resolveHandler = this.vscTestController.resolveHandler
  }

  dispose(): void {
    this.vscTestController.dispose()
  }
}

export default class PintosTestController extends TestController {
  public readonly runProfile: vscode.TestRunProfile

  private rootTests: readonly TestItem<vscode.TestItem>[] = []
  private readonly allTests: Map<string, TestItem<vscode.TestItem>> = new Map()
  private queue: TestRunner[] = []
  private currentRunner: TestRunner | null = null
  private output?: vscode.OutputChannel
  private readonly rootPath: string = getCurrentWorkspaceUri().fsPath
  private readonly disposables: vscode.Disposable[] = []

  private constructor (
    public readonly phases: string[]
  ) {
    super()
    this.runProfile = this.createRunProfile(
      "run profile",
      vscode.TestRunProfileKind.Run,
      (request, token) => {
        console.log(`[DEV] Test Run Request: ${request.include?.map(t => t.label) || "All Tests"}`)
        if (token.isCancellationRequested) {
          this.cancel(request)
        } else {
          const runner = this.createTestRunner(request)
          this.enqueue(runner)
        }
      },
      true
    )

    this.vscTestController.refreshHandler = createScopedHandler(async (token: vscode.CancellationToken): Promise<void> => {
      let currentProcess: ChildProcessWithoutNullStreams | undefined
      let stop = false

      token.onCancellationRequested(() => {
        currentProcess?.kill()
        stop = true
      })

      if (!token.isCancellationRequested) {
        const selectedOptions = await executeOrStopOnError({
          message: "Nothing to rebuild",
          execute: () => pickOptions({
            title: "Select the phases to rebuild",
            canSelectMany: true,
            options: this.phases.map(label => ({
              label,
              description: "(clean and build)"
            }))
          }),
          onError: showStopMessage(this.output)
        })

        const targets = selectedOptions.map(prop("label"))

        const testTargets = this.rootTests.filter(t => targets.includes(t.phase))

        const vsctests: vscode.TestItem[] = []

        testTargets.forEach(rootTest => iterableForEach(test => {
          const vsctest = test.data
          vsctest.busy = true
          vsctests.push(vsctest)
          return vsctest
        }, rootTest))

        try {
          await this.cmdFromRootProject(() => waitForEach(async (rootTest) => {
            if (stop) {
              return
            }

            this.output?.show()
            this.output?.appendLine(`[BEGIN] clean and build ${rootTest.phase}\n`)

            currentProcess = cleanAndCompilePhase(rootTest.phase)

            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              cancellable: false,
              title: `Rebuild ${rootTest.phase}`
            }, () => {
              return childProcessToPromise({
                process: currentProcess!,
                onData: (buffer: Buffer) => {
                  this.output?.append(buffer.toString())
                }
              })
            })

            this.output?.appendLine(`[END] build ${rootTest.phase}\n`)
          }, testTargets))
        } finally {
          vsctests.forEach(t => t.busy = false)
        }

        await vscode.commands.executeCommand("testing.clearTestResults")
        testTargets.forEach(
          (toClean) => iterableForEach(item => item.status = "unknown", toClean.testLeafs)
        )
        this.reflectCurrentTestsStatusInUI()
      }
    })
  }

  private cancel(request: vscode.TestRunRequest) {
    const [firstTest] = request.include || iterLikeTolist(this.items)
    const testid = firstTest.id

    if (this.currentRunner?.includes(testid)) {
      this.currentRunner.cancel()
      this.currentRunner = null
      this.dequeueAndRunUntilEmpty()
    } else {
      this.queue = this.queue.filter(runner => runner.includes(testid))
    }
  }

  private async dequeueAndRunUntilEmpty() {
    if (this.currentRunner) {
      throw new Error("wait until the current process finish")
    }

    if (this.queue.length > 0) {
      const runner = this.queue.shift()!
      this.currentRunner = runner
      this.output?.show()
      await scopedCommand({
        cwd: getCurrentWorkspaceUri().fsPath,
        execute: () => runner.start()
      })
      this.currentRunner = null
      this.dequeueAndRunUntilEmpty()
    }
  }

  public static async create(descriptor: {
    phases: string[]
    output?: vscode.OutputChannel
  }): Promise<PintosTestController> {
    const controller = new PintosTestController(descriptor.phases)
    controller.output = descriptor.output
    const fns = bind(controller)

    const tests = await controller.discoverTests()
    controller.rootTests = tests
    controller.watchTestsFiles()

    tests.forEach((test, i) => {
      test.children.forEach((subtest) => {
        iterableForEach(item => item.beforeRun = fns.beforeRunTests, subtest)
      })
      test.data.label = `Phase ${i + 1} (${test.phase})`
      controller.items.add(test.data)
    })

    controller.reflectCurrentTestsStatusInUI()

    return controller
  }

  public async beforeRunTests({ item, runningTestid }: TestRunRequest) {
    if (await item.existsResultFile()) {
      if (runningTestid !== item.gid) {
        return true
      }

      try {
        const pluralsMsg = item.isComposite ? "results" : "result"
        const [cancel] = await pickOptions({
          title: `Do you want to re run "${item.name}"`,
          options: [
            { label: `Clean the ${pluralsMsg} and run`, cancel: false },
            { label: "Cancel", cancel: true }
          ],
          mapFn: option => option.cancel
        })

        if (!cancel) {
          await item.removeFiles()
          return true
        }

        return false
      } catch {
        return false
      }
    }

    return true
  }

  public reflectCurrentTestsStatusInUI () {
    const runner = this.createTestRunner()
    runner.reflectCurrentTestsStatusInUI()
    runner.dispose()
  }

  public createTestRunner (request: Partial<vscode.TestRunRequest> = {}) {
    const runner = new TestRunner({
      allTests: this.allTests,
      controller: this,
      output: this.output,
      request
    })

    return runner
  }

  public enqueue(runner: TestRunner) {
    if (this.isEnqueued(runner)) {
      runner.dispose()
      vscode.window.showWarningMessage("The test is already in the run process")
      return
    }

    this.queue.push(runner)
    runner.markAsEnqueued()

    if (!this.currentRunner) {
      this.dequeueAndRunUntilEmpty()
    }
  }

  public isEnqueued(runner: TestRunner): boolean {
    const [firstTest] = runner.tests
    const testid = firstTest.gid

    return this.currentRunner?.includes(testid) || !!this.queue.find(runner => runner.includes(testid))
  }

  public discoverTests(): Promise<TestItem<vscode.TestItem>[]> {
    return this.cmdFromRootProject(async () => {
      const phases = this.phases
      const getTestFrom = (phase: string) => ensureLookupTestsInPhase({
        onMissingLocation: ({ phase }) => this.cmdFromRootProject(async () => {
          this.output?.show()
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            cancellable: false,
            title: `Build ${phase}`
          }, () => onMissingTestDir({ phase, output: this.output }))
        }),
        generateId: generateTestId,
        getDirOf: getDirOfTest,
        getNameOf: getNameOfTest,
        onMissingDiscoverMakefile,
        testDataBuilder: (test: Readonly<TestItem<vscode.TestItem>>) => {
          this.allTests.set(test.gid, <TestItem<vscode.TestItem>> test)
          const vsctest: vscode.TestItem = this.createTestItem(test.gid, test.name)

          vsctest.description = vsctestDescription(test.backless)

          test.children.map(item => item.data).forEach(child => vsctest.children.add(child))
          return vsctest
        },
        splitId: splitTestId
      }, { path: "build", phase })

      return waitMap(getTestFrom, phases)
    })
  }

  private watchTestsFiles() {
    const folders = this.phases.map(phase => uriFromCurrentWorkspace(phase)).map(
      uri => vscode.workspace.getWorkspaceFolder(uri)!
    ).filter(folder => !!folder)

    const watcher = new PintosTestsFsWatcher({
      folders,
      rootTests: this.rootTests,
      controller: this
    })

    watcher.start()

    this.disposables.push(watcher)
  }

  public isWithinActiveTestRunners(testid: string) {
    return this.currentRunner && this.currentRunner.includes(testid)
  }

  public findTestByResultFile(file: string) {
    for (let rootTest of this.rootTests) {
      const test = rootTest.lookup({
        by: "custom",
        search: item => item.resultFile === file
      })

      if (test) {
        return test
      }
    }

    return null
  }

  private cmdFromRootProject<R>(execute: ScopedCommandExecutor<R>) {
    return scopedCommand({
      cwd: this.rootPath,
      execute
    })
  }

  dispose(): void {
    this.disposables.forEach(disposable => disposable.dispose())
    super.dispose()
  }
}


class TestRunner implements vscode.Disposable {
  public readonly tests: readonly TestItem<vscode.TestItem>[]
  private enqueued = false
  private readonly testRun: vscode.TestRun
  private readonly output?: OutputChannel

  private queue: TestItem<vscode.TestItem>[]
  private currentProcess: TestItem<vscode.TestItem> | null = null

  private readonly statusHandler = this.reflectTestStatusInUI.bind(this)

  constructor ({
    output, controller, allTests, request
  }: {
    request: Partial<vscode.TestRunRequest>
    controller: vscode.TestController
    allTests: ReadonlyMap<string, TestItem<vscode.TestItem>>
    output?: OutputChannel
  }) {
    this.testRun = controller.createTestRun({
      exclude: request.exclude,
      include: request.include,
      profile: request.profile
    }, "runner@".concat(new Date().toISOString()))

    this.testRun.token.onCancellationRequested(() => {
      if (this.enqueued) {
        console.log(`Canceled Test Run ${this.testRun.name}`)
      }
      this.cancel()
    }, this.testRun)

    const vscTests = request.include || iterLikeTolist(controller.items)
    this.tests = vscTests.map(({ id }) => allTests.get(id)!)
    this.queue = [...this.tests]
    this.output = output
    this.statusHandler = this.reflectTestStatusInUI.bind(this)

    this.tests.forEach(test => test.on("status", this.statusHandler))
  }

  public markAsEnqueued () {
    this.enqueued = true
    this.tests.forEach((item) => iterableForEach(test => test.status = "enqueued", item.testLeafs))
  }

  public cancel () {
    this.queue = []
    this.currentProcess?.stop()
    this.dispose()
    this.enqueued = false
  }

  public async start() {
    this.enqueued = true
    this.tests.forEach((item) => iterableForEach(test => test.status = "started", item.testLeafs))
    await this.dequeueAndRunUntilEmpty()
    this.enqueued = false
    this.dispose()
  }

  private async dequeueAndRunUntilEmpty() {
    if (this.currentProcess) {
      throw new Error("wait until the current process finish")
    }

    if (this.queue.length > 0) {
      const test = this.queue.shift()!
      this.currentProcess = test
      await test.run({
        output: this.output,
        runningTestid: test.gid
      })
      this.currentProcess = null
      await this.dequeueAndRunUntilEmpty()
    }
  }

  public reflectCurrentTestsStatusInUI () {
    this.tests.forEach(test => iterableForEach(item => this.statusHandler(item, item.status), test))
  }

  private reflectTestStatusInUI (test: TestItem<vscode.TestItem>, status: TestStatus) {
    if (test.isComposite) {
      return
    }

    const vscTest = test.data

    const appendStatus = () => {
      if (!test.isComposite) {
        this.testRun.appendOutput(`${status} ${test.phase} ${test.id}\r\n`, undefined, vscTest)
      }
    }

    switch (status) {
      case "enqueued":
      case "skipped":
      case "started":
        this.testRun[status](vscTest)
        break
      case "errored":
      case "failed":
        appendStatus()
        this.testRun[status](vscTest, new vscode.TestMessage("unknown error"))
        break
      case "passed":
        appendStatus()
        this.testRun[status](vscTest)
        break
      case "unknown":
        // NOTE: "unknown" preserves the previous status
        break
      default:
        throw new Error(`status ${status} is not handled`)
    }
  }

  includes (testid: string): boolean {
    return !!this.tests.find(test => !!test.lookup({ by: "testid", search: testid }))
  }

  dispose() {
    this.tests.forEach(test => test.off("status", this.statusHandler))
    this.testRun.end()
  }
}


class PintosTestsFsWatcher implements vscode.Disposable {
  public readonly folders: vscode.WorkspaceFolder[]

  private started = false
  private readonly disposables: vscode.Disposable[] = []
  private readonly controller: PintosTestController
  private readonly rootTests: readonly TestItem<vscode.TestItem>[]
  private currentRefreshTimeout: NodeJS.Timeout | undefined
  private testsToUpdate: TestItem<vscode.TestItem>[] = []

  private backlessHandler = this.changeDescriptionOf.bind(this)
  private statusHandler = this.addToUpdateTests.bind(this)
  private renderKey = 0

  constructor (args: {
    folders: vscode.WorkspaceFolder[]
    controller: PintosTestController
    rootTests: readonly TestItem<vscode.TestItem>[]
  }) {
    this.folders = args.folders
    this.controller = args.controller
    this.rootTests = args.rootTests
  }

  start () {
    if (this.started) {
      throw new Error("Watcher already started")
    }

    this.started = true

    this.rootTests.forEach(test => {
      test.on("backless", this.backlessHandler)
      test.on("status", this.statusHandler)
    })

    this.folders
      .map(folder => {
        if (!folder) {
          return null
        }

        const pattern = new vscode.RelativePattern(folder, "**/*.result")
        const watcher = vscode.workspace.createFileSystemWatcher(pattern)

        const changeStatusOfTest = ({ fsPath }: vscode.Uri) => {
          const test = this.controller.findTestByResultFile(fsPath)
          if (test) {
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

        watcher.onDidCreate(changeStatusOfTest)
        watcher.onDidChange(changeStatusOfTest)
        watcher.onDidDelete(notifyResultFileDeletion)

        return watcher
      })
      .filter(item => item !== null)
      .forEach(diposable => this.disposables.push(diposable!))
  }

  public changeDescriptionOf (item: TestItem<vscode.TestItem>, backless: boolean) {
    const vsctest = item.data
    vsctest.description = (this.renderKey++).toString()
    vsctest.description = vsctestDescription(backless)
  }

  public addToUpdateTests (item: TestItem<vscode.TestItem>) {
    const testid = item.gid
    const active = this.controller.isWithinActiveTestRunners(testid)
    if (!active && !item.isComposite) {
      this.testsToUpdate.push(item)

      if (!this.currentRefreshTimeout) {
        this.currentRefreshTimeout = setTimeout(this.updateStatusTestsInUI, 1000)
      }
    }
  }

  updateStatusTestsInUI () {
    const testRunner = this.controller.createTestRunner({
      include: this.testsToUpdate.map(({ data }) => data)
    })
    testRunner.reflectCurrentTestsStatusInUI()
    testRunner.dispose()
    this.currentRefreshTimeout = undefined
  }

  dispose() {
    clearTimeout(this.currentRefreshTimeout)
    this.rootTests.forEach(test => {
      test.off("backless", this.backlessHandler)
      test.off("status", this.statusHandler)
    })
    this.disposables.forEach(d => d.dispose())
  }
}

const vsctestDescription = (backless: boolean) => backless ? "(backless)" : ""
