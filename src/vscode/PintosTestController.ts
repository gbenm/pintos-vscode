import * as vscode from "vscode"
import { ensureLookupTestsInPhase } from "../core/grade/lookup"
import { TestItem, TestRunRequest, TestStatus } from "../core/grade/TestItem"
import { childProcessToPromise, scopedCommand, ScopedCommandExecutor } from "../core/launch"
import { getCurrentWorkspaceUri, pickOptions, showStopMessage, createScopedHandler, uriFromCurrentWorkspace } from "./utils"
import { generateTestId, getDirOfTest, getNameOfTest, onMissingDiscoverMakefile, onMissingTestDir, splitTestId } from "../core/grade/utils"
import { bind, iterableForEach, iterLikeTolist, prop, waitForEach, waitMap } from "../core/utils/fp/common"
import { cleanAndCompilePhase } from "../core/grade/compile"
import { setStatusFromResultFile } from "../core/grade/run"
import { executeOrStopOnError } from "./errors"
import { ChildProcessWithoutNullStreams } from "node:child_process"
import colors from "../core/utils/colors"
import PintosTestsFsWatcher from "./PintosTestsFsWatcher"
import Storage from "./Storage"
import TestRunner from "./run/TestRunner"

export interface TestController extends vscode.TestController {
  readonly rootTests: readonly TestItem<vscode.TestItem>[]
  readonly allTests: ReadonlyMap<string, TestItem<vscode.TestItem>>
  readonly output?: Readonly<vscode.OutputChannel>

  saveLastExecutionTimeOf (testid: string, milliseconds: number | undefined): void
  findTestByResultFile(file: string): TestItem<vscode.TestItem> | null
  isWithinActiveTestRunners(testid: string): boolean
  createTestRunner (request?: Partial<vscode.TestRunRequest>): TestRunner
  cancel(request: vscode.TestRunRequest): void
  enqueue(runner: TestLotProcess): void
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
  abstract cancel(request: vscode.TestRunRequest): void
  abstract enqueue(runner: TestLotProcess): void
}

export default class PintosTestController extends VSCTestController {
  public rootTests: readonly TestItem<vscode.TestItem>[] = []
  public readonly allTests: Map<string, TestItem<vscode.TestItem>> = new Map()
  public output?: vscode.OutputChannel

  private queue: TestLotProcess[] = []
  private currentRunner: TestLotProcess | null = null
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
      build => build(controller)
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

  public enqueue(runner: TestLotProcess) {
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

  public isEnqueued(runner: TestLotProcess): boolean {
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


export const vsctestDescription = (backless: boolean) => backless ? "(backless)" : ""


export abstract class TestRunProfile {
  readonly profile: vscode.TestRunProfile
  readonly controller: TestController

  constructor ({ controller, label }: {
    controller: TestController
    label: string
  }) {
    this.controller = controller
    this.profile = controller.createRunProfile(
      label,
      vscode.TestRunProfileKind.Run,
      (request, token) => {
        console.log(`[DEV] Test Run Request: ${request.include?.map(t => t.label) || "All Tests"}`)
        if (token.isCancellationRequested) {
          controller.cancel(request)
        } else {
          const runner = this.createProcess(request)
          controller.enqueue(runner)
        }
      },
      true
    )
  }

  abstract createProcess (request: vscode.TestRunRequest): TestLotProcess
}
