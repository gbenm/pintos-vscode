import * as vscode from "vscode"
import { ensureLookupTestsInPhase } from "../core/grade/lookup"
import { TestItem, TestRunRequest, TestStatus } from "../core/grade/TestItem"
import { childProcessToPromise, scopedCommand, ScopedCommandExecutor, SpawnAbortRequest } from "../core/launch"
import { getCurrentWorkspaceUri, pickOptions, showStopMessage, createScopedHandler, uriFromCurrentWorkspace, withErrorHandler } from "./utils"
import { generateTestId, getDirOfTest, getNameOfTest, onMissingDiscoverMakefile, onMissingTestDir, splitTestId } from "../core/grade/utils"
import { bind, iterableForEach, iterLikeTolist, prop, waitForEach, waitMap } from "../core/utils/fp/common"
import { cleanAndCompilePhase } from "../core/grade/compile"
import { setStatusFromResultFile } from "../core/grade/run"
import { executeOrStopOnError, PintOSExtensionCancellationError } from "./errors"
import { ChildProcessWithoutNullStreams } from "node:child_process"
import colors from "../core/utils/colors"
import PintosTestsFsWatcher from "./PintosTestsFsWatcher"
import Storage from "./Storage"
import PintosShell from "../core/launch/PintosShell"
import { Config } from "./config"
import { searchFileByName } from "../core/utils"

export interface TestController extends vscode.TestController {
  readonly rootTests: readonly TestItem<vscode.TestItem>[]
  readonly allTests: ReadonlyMap<string, TestItem<vscode.TestItem>>
  readonly output?: Readonly<vscode.OutputChannel>
  readonly shell: PintosShell

  saveLastExecutionTimeOf (testid: string, milliseconds: number | undefined): void
  findTestByResultFile(file: string): TestItem<vscode.TestItem> | null
  isWithinActiveTestRunners(testid: string): boolean
  createTestLotUiManager (request?: Partial<vscode.TestRunRequest>): TestLotUiManager
  cancel(request: vscode.TestRunRequest): void
  enqueue(runner: TestLotProcess): void
}


export abstract class VSCTestController implements TestController, vscode.Disposable {
  public shell: PintosShell
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
    const nativeKill = Config.useNodejsNativeKill

    if (nativeKill) {
      console.warn("Some children processes could not be killed if you use the native kill")
    }

    this.shell = PintosShell.create({ nativeKill })
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
  abstract createTestLotUiManager(request?: Partial<vscode.TestRunRequest>): TestLotUiManager
  abstract cancel(request: vscode.TestRunRequest): void
  abstract enqueue(runner: TestLotProcess): void
}

export default class PintosTestController extends VSCTestController {
  public rootTests: readonly TestItem<vscode.TestItem>[] = []
  public readonly allTests: Map<string, TestItem<vscode.TestItem>> = new Map()
  public output?: vscode.OutputChannel

  private queue: TestLotProcess[] = []
  private currentTestProcess: TestLotProcess | null = null
  private readonly rootPath: string = getCurrentWorkspaceUri().fsPath
  private readonly disposables: vscode.Disposable[] = []

  private constructor (
    private storage: Storage,
    public readonly phases: string[]
  ) {
    super()
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

  public cancel(request: vscode.TestRunRequest) {
    const [firstTest] = request.include || iterLikeTolist(this.items)
    const testid = firstTest.id

    if (this.currentTestProcess?.includes(testid)) {
      this.currentTestProcess.cancel()
      this.currentTestProcess = null
      this.dequeueAndRunUntilEmpty()
    } else {
      this.queue = this.queue.filter(runner => runner.includes(testid))
    }
  }

  private async dequeueAndRunUntilEmpty() {
    if (this.currentTestProcess) {
      throw new Error("wait until the current process finish")
    }

    if (this.queue.length > 0) {
      const testProcess = this.queue.shift()!
      this.currentTestProcess = testProcess
      this.output?.show()
      await createScopedHandler(scopedCommand, {
        cwd: getCurrentWorkspaceUri().fsPath,
        execute: () => testProcess.start()
      })()
      this.currentTestProcess = null
      await this.dequeueAndRunUntilEmpty()
    }
  }

  public static async create(descriptor: {
    phases: string[]
    context: vscode.ExtensionContext
    output?: vscode.OutputChannel
    profilesBuilders: TestRunProfilesBuilders
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

    descriptor.profilesBuilders.forEach(
      build => controller.disposables.push(build(controller))
    )

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
    const uiManager = this.createTestLotUiManager()
    uiManager.reflectCurrentTestsStatusInUI()
    uiManager.dispose()
  }

  public createTestLotUiManager (request: Partial<vscode.TestRunRequest> = {}): TestLotUiManager {
    const manager = new TestLotUiManager({
      controller: this,
      request
    })

    return manager
  }

  public copyTestsStatusFromResultFiles () {
    this.rootTests.forEach((rootTest) => iterableForEach(test => setStatusFromResultFile(test), rootTest.testLeafs))
  }

  public enqueue(testLotProcess: TestLotProcess) {
    if (this.isEnqueued(testLotProcess)) {
      testLotProcess.dispose()
      vscode.window.showWarningMessage("The test is already in the run process")
      return
    }

    const isBusy = this.queue.length > 0 || !!this.currentTestProcess
    if (isBusy && !testLotProcess.canWait()) {
      testLotProcess.dispose()
      return
    }

    this.queue.push(testLotProcess)
    testLotProcess.markAsEnqueued()

    if (!this.currentTestProcess) {
      this.dequeueAndRunUntilEmpty()
    }
  }

  public isEnqueued(runner: TestLotProcess): boolean {
    const [firstTest] = runner.tests
    const testid = firstTest.gid

    return this.currentTestProcess?.includes(testid) || !!this.queue.find(runner => runner.includes(testid))
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

          let filepath = undefined
          if (test.children.length === 0) {
            filepath = test.resultFile
          }

          const uri = filepath ? vscode.Uri.parse(filepath) : undefined
          const vsctest: vscode.TestItem = this.createTestItem(test.gid, test.name, uri)

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
      controller: this
    })

    watcher.start()

    this.disposables.push(watcher)
  }

  public isWithinActiveTestRunners(testid: string) {
    return !!this.currentTestProcess && this.currentTestProcess.includes(testid)
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
    this.currentTestProcess?.cancel()
    this.queue.forEach(p => p.cancel())
    this.disposables.forEach(disposable => disposable.dispose())
    super.dispose()
  }
}


export type TestRunProfilesBuilders = Array<(controller: TestController) => TestRunProfile>


export class TestLotUiManager implements vscode.Disposable {
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


export abstract class TestLotProcess extends TestLotUiManager {
  protected queue: TestItem<vscode.TestItem>[]
  protected currentProcess: TestItem<vscode.TestItem> | null = null
  protected shell: PintosShell
  protected compiledPhases: string[] = []
  private _compilationAbortController?: AbortController

  protected get compilationAbortController (): AbortController | undefined {
    return this._compilationAbortController
  }

  constructor (args: {
    request: Partial<vscode.TestRunRequest>
    label?: string
    controller: TestController
  }) {
    super(args)
    this.queue = [...this.tests]
    this.shell = this.controller.shell
  }

  public async start() {
    try {
      this.enqueued = true
      this.tests.forEach((item) => iterableForEach(test => test.status = "started", item.testLeafs))
      await this.dequeueAndRunUntilEmpty()
    } finally {
      this.enqueued = false
      this.dispose()
    }
  }

  public cancel () {
    this.queue = []
    this.currentProcess?.stop()
    super.cancel()
  }

  protected async compileIfNeeded (test: TestItem) {
    if (!this.compiledPhases.includes(test.phase)) {
      await this.compile(test)
      this.compiledPhases.push(test.phase)
    }
  }

  protected async compile (test: TestItem) {
    this._compilationAbortController = new AbortController()

    this.controller.output?.appendLine(`[make] compile ${test.phase}\n`)
    await childProcessToPromise({
      process: this.shell.make({
        cwd: test.phase,
        args: []
      }),
      onData: (buffer: Buffer) => {
        this.controller.output?.append(buffer.toString())
      },
      abort: this.compilationAbortController?.signal
    })
    this.controller.output?.appendLine("")
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

  public canWait () {
    return true
  }

  dispose(): void {
    this.compilationAbortController?.abort(SpawnAbortRequest.of({
      error: new PintOSExtensionCancellationError()
    }))
    super.dispose()
  }

  protected abstract execute(test: TestItem<vscode.TestItem>): Promise<void>
}


export const vsctestDescription = (backless: boolean) => backless ? "(backless)" : ""


export abstract class TestRunProfile implements vscode.Disposable {
  readonly profile: vscode.TestRunProfile
  readonly controller: TestController

  constructor ({ controller, label, isDefault = false, kind }: {
    controller: TestController
    label: string
    isDefault?: boolean
    kind: vscode.TestRunProfileKind
  }) {
    this.controller = controller
    this.profile = controller.createRunProfile(
      label,
      kind,
      withErrorHandler((request: vscode.TestRunRequest, token: vscode.CancellationToken) => {
        console.log(`[DEV] (${label}) Test Run Request: ${request.include?.map(t => t.label) || "All Tests"}`)
        if (token.isCancellationRequested) {
          controller.cancel(request)
        } else {
          const runner = this.createProcess(request)
          controller.enqueue(runner)
        }
      }),
      isDefault
    )
  }

  dispose() {
    this.profile.dispose()
  }

  abstract createProcess (request: vscode.TestRunRequest): TestLotProcess
}
