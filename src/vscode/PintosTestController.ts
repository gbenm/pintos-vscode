import * as vscode from "vscode"
import { ensureLookupTestsInPhase } from "../core/grade/lookup"
import { TestItem, TestRunRequest, TestStatus } from "../core/grade/TestItem"
import { childProcessToPromise, scopedCommand, ScopedCommandExecutor } from "../core/launch"
import { getCurrentWorkspaceUri, pickOptions, showStopMessage, createScopedHandler, uriFromCurrentWorkspace } from "./utils"
import { generateTestId, getDirOfTest, getNameOfTest, onMissingDiscoverMakefile, onMissingTestDir, splitTestId } from "../core/grade/utils"
import { bind, iterableForEach, iterLikeTolist, prop, waitForEach, waitMap } from "../core/utils/fp/common"
import { FunctionsOf } from "../core/types"
import { cleanAndCompilePhase } from "../core/grade/compile"
import { setStatusFromResultFile } from "../core/grade/run"
import { executeOrStopOnError } from "./errors"
import { ChildProcessWithoutNullStreams } from "node:child_process"
import colors from "../core/utils/colors"

export interface TestController extends vscode.TestController {
  readonly rootTests: readonly TestItem<vscode.TestItem>[]
  readonly allTests: ReadonlyMap<string, TestItem<vscode.TestItem>>
  readonly output?: Readonly<vscode.OutputChannel>

  saveLastExecutionTimeOf (testid: string, milliseconds: number | undefined): void
  findTestByResultFile(file: string): TestItem<vscode.TestItem> | null
  isWithinActiveTestRunners(testid: string): boolean
  createTestRunner (request?: Partial<vscode.TestRunRequest>): TestRunner
}


export abstract class VSCTestController implements TestController, vscode.Disposable {
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

  abstract rootTests: readonly TestItem<vscode.TestItem>[]
  abstract allTests: ReadonlyMap<string, TestItem<vscode.TestItem>>
  abstract output?: Readonly<vscode.OutputChannel>

  abstract saveLastExecutionTimeOf(testid: string, milliseconds: number | undefined): void
  abstract findTestByResultFile(file: string): TestItem<vscode.TestItem> | null
  abstract isWithinActiveTestRunners(testid: string): boolean
  abstract createTestRunner(request?: Partial<vscode.TestRunRequest>): TestRunner
}

export default class PintosTestController extends VSCTestController {
  public readonly runProfile: vscode.TestRunProfile

  public rootTests: readonly TestItem<vscode.TestItem>[] = []
  public readonly allTests: Map<string, TestItem<vscode.TestItem>> = new Map()
  public output?: vscode.OutputChannel

  private queue: TestRunner[] = []
  private currentRunner: TestRunner | null = null
  private readonly rootPath: string = getCurrentWorkspaceUri().fsPath
  private readonly disposables: vscode.Disposable[] = []

  private constructor (
    private storage: Storage,
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
    context: vscode.ExtensionContext
    output?: vscode.OutputChannel
  }): Promise<PintosTestController> {
    const storage = new Storage(descriptor.context.workspaceState, "testController")
    const controller = new PintosTestController(storage, descriptor.phases)
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

  public createTestRunner (request: Partial<vscode.TestRunRequest> = {}): TestRunner {
    const runner = new TestRunner({
      controller: this,
      request
    })

    return runner
  }

  public copyTestsStatusFromResultFiles () {
    this.rootTests.forEach((rootTest) => iterableForEach(test => setStatusFromResultFile(test), rootTest.testLeafs))
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
        getDirOf: (testid) => {
          if (testid === "tests" || testid === `pintos.error/${phase}`) {
            return uriFromCurrentWorkspace(phase).fsPath
          }
          return getDirOfTest(testid)
        },
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

      return waitMap(async (phase) => {
        const test = await getTestFrom(phase)
        iterableForEach(item => {
          item.lastExecutionTime = this.storage.of(item.gid).get("lastExecutionTime")
        }, test.testLeafs)
        return test
      }, phases)
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
    return !!this.currentRunner && this.currentRunner.includes(testid)
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

  public saveLastExecutionTimeOf (testid: string, milliseconds: number | undefined) {
    if (typeof milliseconds === "number") {
      this.storage.of(testid).update("lastExecutionTime", milliseconds)
    }
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


class TestLotUiManager implements vscode.Disposable {
  public readonly tests: readonly TestItem<vscode.TestItem>[]

  protected readonly testRun: vscode.TestRun
  protected readonly controller: TestController
  protected enqueued = false

  private readonly statusHandler = this.reflectTestStatusInUI.bind(this)

  constructor ({
    controller, request, label = "testLotUi"
  }: {
    request: Partial<vscode.TestRunRequest>
    label?: string
    controller: TestController
  }) {
    this.controller = controller
    this.testRun = controller.createTestRun({
      exclude: request.exclude,
      include: request.include,
      profile: request.profile
    }, label.concat("@", new Date().toISOString()))

    this.testRun.token.onCancellationRequested(() => {
      if (this.enqueued) {
        console.log(`${this.testRun.name} canceled`)
      }
      this.cancel()
    })

    const vscTests = request.include || iterLikeTolist(controller.items)
    this.tests = vscTests.map(({ id }) => controller.allTests.get(id)!)
    this.statusHandler = this.reflectTestStatusInUI.bind(this)

    this.tests.forEach(test => test.on("status", this.statusHandler))
  }

  public markAsEnqueued () {
    this.enqueued = true
    this.tests.forEach((item) => iterableForEach(test => test.status = "enqueued", item.testLeafs))
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
        this.testRun.appendOutput(`${colors[status](status)} ${colors.gray(test.phase)} ${test.id}\r\n`, undefined, vscTest)
      }
    }

    const saveExecutionTime = () => {
      this.controller.saveLastExecutionTimeOf(vscTest.id, test.lastExecutionTime)
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
        saveExecutionTime()
        this.testRun[status](vscTest, new vscode.TestMessage("unknown error"), test.lastExecutionTime)
        break
      case "passed":
        appendStatus()
        saveExecutionTime()
        this.testRun[status](vscTest, test.lastExecutionTime)
        break
      case "unknown":
        // NOTE: "unknown" preserves the previous status
        break
      default:
        throw new Error(`status ${status} is not handled`)
    }
  }

  public includes (testid: string): boolean {
    return !!this.tests.find(test => !!test.lookup({ by: "testid", search: testid }))
  }

  public cancel () {
    this.dispose()
    this.enqueued = false
  }

  dispose() {
    this.tests.forEach(test => test.off("status", this.statusHandler))
    this.testRun.end()
  }
}


abstract class TestLotProcess extends TestLotUiManager {
  protected queue: TestItem<vscode.TestItem>[]
  protected currentProcess: TestItem<vscode.TestItem> | null = null

  constructor (args: {
    request: Partial<vscode.TestRunRequest>
    label?: string
    controller: TestController
  }) {
    super(args)
    this.queue = [...this.tests]
  }

  public async start() {
    this.enqueued = true
    this.tests.forEach((item) => iterableForEach(test => test.status = "started", item.testLeafs))
    await this.dequeueAndRunUntilEmpty()
    this.enqueued = false
    this.dispose()
  }

  public cancel () {
    this.queue = []
    this.currentProcess?.stop()
    super.cancel()
  }

  private async dequeueAndRunUntilEmpty() {
    if (this.currentProcess) {
      throw new Error("wait until the current process finish")
    }

    if (this.queue.length > 0) {
      const test = this.queue.shift()!
      this.currentProcess = test
      await this.execute(test)
      this.currentProcess = null
      await this.dequeueAndRunUntilEmpty()
    }
  }

  protected abstract execute(test: TestItem<vscode.TestItem>): Promise<void>
}


class TestRunner extends TestLotProcess {
  constructor (args: {
    request: Partial<vscode.TestRunRequest>
    controller: TestController
  }) {
    super({ ...args, label: "runner" })
  }

  protected async execute(test: TestItem<vscode.TestItem>): Promise<void> {
    await test.run({
      output: this.controller.output,
      runningTestid: test.gid
    })
  }
}


class PintosTestsFsWatcher implements vscode.Disposable {
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
    rootTests: readonly TestItem<vscode.TestItem>[]
  }) {
    this.folders = args.folders
    this.controller = args.controller
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
    this.watchBuildDirs()
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

  private watchBuildDirs() {
    this.controller.rootTests.forEach((test) => {
      const pattern = new vscode.RelativePattern(test.basePath, "build")
      const watcher = vscode.workspace.createFileSystemWatcher(pattern, true, true)

      watcher.onDidDelete(() => {
        iterableForEach(child => child.backless = true, test.testLeafs)
      })

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
    const testRunner = this.controller.createTestRunner({
      include: this.testsToUpdate.map(({ data }) => data)
    })
    testRunner.reflectCurrentTestsStatusInUI()
    testRunner.dispose()
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


class Storage implements vscode.Memento {
  private readonly prefix: string

  constructor (
    private readonly memento: vscode.Memento,
    public readonly name: string
  ) {
    this.prefix = `@${name}:`
  }

  keys(): readonly string[] {
    return this.memento.keys().filter(
      name => name.startsWith(this.prefix)
    )
  }

  get<T>(key: string): T | undefined
  get<T>(key: string, defaultValue: T): T
  get<T>(key: string, defaultValue?: T | undefined): T | undefined {
    const fullKey = this.prefix.concat(key)
    if (typeof defaultValue === "undefined") {
      return this.memento.get<T>(fullKey)
    }

    return this.memento.get<T>(fullKey, defaultValue)
  }

  update(key: string, value: any): Thenable<void> {
    const fullKey = this.prefix.concat(key)
    return this.memento.update(fullKey, value)
  }

  of (baseKey: string): SubStorage {
    return new Proxy(this, {
      get (target: SubStorage, method: keyof SubStorage) {
        return (key: string, ...args: [any]) => target[method](`${baseKey}.${key}`, ...args)
      }
    })
  }
}

export type SubStorage = Pick<FunctionsOf<Storage>, "get" | "update" | "of">

const vsctestDescription = (backless: boolean) => backless ? "(backless)" : ""
