import * as vscode from "vscode"
import { ensureLookupTestsInPhase } from "../core/grade/lookup"
import { TestItem } from "../core/grade/TestItem"
import { childProcessToPromise, scopedCommand, ScopedCommandExecutor } from "../core/launch"
import { getCurrentWorkspaceUri, pickOptions, showStopMessage, createScopedHandler } from "./utils"
import { generateTestId, getDirOfTest, getNameOfTest, onMissingDiscoverMakefile, onMissingTestDir, splitTestId } from "../core/grade/utils"
import { bind, iterableForEach, iterLikeTolist, prop, waitForEach, waitMap } from "../core/utils/fp/common"
import { OutputChannel } from "../core/types"
import { cleanAndCompilePhase } from "../core/grade/compile"
import { setStatusFromResultFile } from "../core/grade/run"
import { executeOrStopOnError } from "./errors"

export class TestController implements vscode.TestController {
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
  public dispose: vscode.TestController["dispose"]
  public refreshHandler: vscode.TestController["refreshHandler"]
  public resolveHandler: vscode.TestController["resolveHandler"]

  constructor () {
    this.vscTestController = vscode.tests.createTestController("pintos", "PintOS")
    this.createRunProfile = this.vscTestController.createRunProfile
    this.createTestItem = this.vscTestController.createTestItem
    this.createTestRun = this.vscTestController.createTestRun
    this.refreshHandler = this.vscTestController.refreshHandler
    this.resolveHandler = this.vscTestController.resolveHandler
    this.dispose = this.vscTestController.dispose
  }
}

export default class PintosTestController extends TestController {
  public rootTests: readonly TestItem[] = []
  public readonly allTests: Map<string, TestItem> = new Map()
  public readonly allvscTests: Map<string, vscode.TestItem> = new Map()
  public runProfile: vscode.TestRunProfile

  private queue: TestRunner[] = []
  private currentRunner: TestRunner | null = null
  private output?: vscode.OutputChannel
  private readonly rootPath: string = getCurrentWorkspaceUri().fsPath

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
      if (token.isCancellationRequested) {
        vscode.window.showInformationMessage("Cancel the refresh request is not supported")
      } else {
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
        const restOfTests = this.rootTests.filter(t => !targets.includes(t.phase))

        await this.cmdFromRootProject(() => waitForEach(async (rootTest) => {
          this.output?.show()
          this.output?.appendLine(`[BEGIN] clean and build ${rootTest.phase}\n`)

          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            cancellable: false,
            title: `Rebuild ${rootTest.phase}`
          }, () => childProcessToPromise({
            process: cleanAndCompilePhase(rootTest.phase),
            onData: (buffer: Buffer) => {
              this.output?.append(buffer.toString())
            }
          }))

          this.output?.appendLine(`[END] build ${rootTest.phase}\n`)
        }, testTargets))

        await vscode.commands.executeCommand("testing.clearTestResults")
        testTargets.forEach(
          (toClean) => iterableForEach(item => item.status = "unknown", toClean.testLeafs)
        )
        restOfTests.forEach(
          (rootTest) => iterableForEach(test => setStatusFromResultFile(test), rootTest.testLeafs)
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

    tests.forEach((test, i) => {
      test.children.forEach((subtest) => {
        iterableForEach(item => item.beforeRun = fns.beforeRunTests, subtest)
      })
      const vscTest = test.map(tovscTestItem, {
        controller,
        tags: []
      })
      vscTest.label = `Phase ${i + 1} (${test.phase})`
      controller.items.add(vscTest)
    })

    controller.reflectCurrentTestsStatusInUI()

    return controller
  }

  public async beforeRunTests(item: TestItem) {
    if (await item.existsResultFile()) {
      try {
        const [cancel] = await pickOptions({
          title: "Do you want to re-run the test?",
          options: [
            { label: "Re run the test", cancel: false },
            { label: "Cancel", cancel: true }
          ],
          mapFn: option => option.cancel
        })
        console.log(`cancel? ${cancel}`)

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
      allvscTests: this.allvscTests,
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
    runner.enqueued = true

    if (!this.currentRunner) {
      this.dequeueAndRunUntilEmpty()
    }
  }

  public isEnqueued(runner: TestRunner): boolean {
    const [firstTest] = runner.tests
    const testid = firstTest.gid

    return this.currentRunner?.includes(testid) || !!this.queue.find(runner => runner.includes(testid))
  }

  public discoverTests(): Promise<TestItem[]> {
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
        splitId: splitTestId
      }, { path: "build", phase })

      return waitMap(getTestFrom, phases)
    })
  }

  private cmdFromRootProject<R>(execute: ScopedCommandExecutor<R>) {
    return scopedCommand({
      cwd: this.rootPath,
      execute
    })
  }
}


class TestRunner implements vscode.Disposable {
  public readonly tests: TestItem[]
  public readonly allvscTests: ReadonlyMap<string, vscode.TestItem>
  public readonly testRun: vscode.TestRun
  public readonly output?: OutputChannel

  public queue: TestItem[]
  private currentProcess: TestItem | null = null

  private readonly statusHandler = this.reflectTestsStatusInUI.bind(this)

  public set enqueued (isEnqueued: boolean) {
    if (isEnqueued) {
      this.tests.forEach((item) => iterableForEach(test => test.status = "enqueued", item.testLeafs))
    } else {
      throw new Error("[DEV] dequeue must be handled externally")
    }
  }

  constructor ({
    allvscTests, output, controller, allTests, request
  }: {
    request: Partial<vscode.TestRunRequest>
    controller: vscode.TestController
    allvscTests: ReadonlyMap<string, vscode.TestItem>
    allTests: ReadonlyMap<string, TestItem>
    output?: OutputChannel
  }) {
    this.testRun = controller.createTestRun({
      exclude: request.exclude,
      include: request.include,
      profile: request.profile
    }, "runner@".concat(new Date().toISOString()))

    this.testRun.token.onCancellationRequested(() => {
      console.log(`Canceled Test Run ${this.testRun.name}`)
      this.cancel()
    }, this.testRun)

    const vscTests = request.include || iterLikeTolist(controller.items)
    this.tests = vscTests.map(({ id }) => allTests.get(id)!)
    this.queue = [...this.tests]
    this.allvscTests = allvscTests
    this.output = output
    this.statusHandler = this.reflectTestsStatusInUI.bind(this)

    this.tests.forEach(test => test.on("status", this.statusHandler))
  }

  public cancel () {
    this.queue = []
    this.currentProcess?.stop()
    this.dispose()
  }

  public async start() {
    this.tests.forEach((item) => iterableForEach(test => test.status = "started", item.testLeafs))
    await this.dequeueAndRunUntilEmpty()
    this.dispose()
  }

  private async dequeueAndRunUntilEmpty() {
    if (this.currentProcess) {
      throw new Error("wait until the current process finish")
    }

    if (this.queue.length > 0) {
      const test = this.queue.shift()!
      this.currentProcess = test
      await test.run(this.output)
      this.currentProcess = null
      await this.dequeueAndRunUntilEmpty()
    }
  }

  public reflectCurrentTestsStatusInUI () {
    this.tests.forEach(test => iterableForEach(this.statusHandler, test))
  }

  public reflectTestsStatusInUI (test: TestItem) {
    const testid = test.gid
    const status = test.status
    const vscTest = this.allvscTests.get(testid)!

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
    return !!this.tests.find(test => !!test.lookup(testid))
  }

  dispose() {
    this.tests.forEach(test => test.off("status", this.statusHandler))
    this.testRun.end()
  }
}


const tovscTestItem = TestItem.createMapper<vscode.TestItem, { tags: vscode.TestTag[], controller: PintosTestController }>((test, fn, { controller, tags: parentTags }) => {
  controller.allTests.set(test.gid, test)
  const vscTest = controller.createTestItem(test.gid, test.name)
  const tags: vscode.TestTag[] = [{ id: `#${test.phase}` }]

  if (test.isComposite) {
    vscTest.canResolveChildren = true
    parentTags = [...parentTags, { id: test.gid }, { id: test.id }]
  } else {
    tags.push(...parentTags, { id: test.gid }, { id: test.id })
  }
  vscTest.tags = tags

  test.children.map(item => item.map(fn, { tags: parentTags, controller: controller })).forEach(child => vscTest.children.add(child))
  controller.allvscTests.set(test.gid, vscTest)

  return vscTest
})
