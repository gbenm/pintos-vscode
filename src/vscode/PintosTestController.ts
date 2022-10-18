import * as vscode from "vscode"
import { ensureLookupTestsInPhase } from "../core/grade/lookup"
import { TestItem } from "../core/grade/TestItem"
import { scopedCommand, ScopedCommandExecutor } from "../core/launch"
import { getCurrentWorkspaceUri } from "./utils"
import { generateTestId, getDirOfTest, getNameOfTest, onMissingDiscoverMakefile, onMissingTestDir, splitTestId } from "../core/grade/utils"
import { iterableForEach, iterLikeTolist, waitMap } from "../core/utils/fp/common"
import { OutputChannel } from "../core/types"

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
  public readonly allTests: Map<string, TestItem> = new Map()
  public readonly allvscTests: Map<string, vscode.TestItem> = new Map()
  public runProfile: vscode.TestRunProfile

  private queue: TestRunner[] = []
  private currentRunner: TestRunner | null = null
  private output?: OutputChannel
  private readonly rootPath: string = getCurrentWorkspaceUri().fsPath

  private constructor (
    public readonly phases: string[]
  ) {
    super()
    this.runProfile = this.createRunProfile(
      "run profile",
      vscode.TestRunProfileKind.Run,
      (request, token) => {
        console.log(`new request ${JSON.stringify(request.include?.map(t => t.label))}`)
        if (token.isCancellationRequested) {
          this.cancel(request)
        } else {
          const runner = this.createTestRunner(request)
          this.enqueue(runner)
        }
      },
      true
    )
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
    output: OutputChannel
  }): Promise<PintosTestController> {
    const controller = new PintosTestController(descriptor.phases)
    controller.output = descriptor.output

    const tests = await controller.discoverTests()

    tests.forEach((test, i) => {
      const vscTest = test.map(tovscTestItem, {
        controller,
        tags: []
      })
      vscTest.label = `Phase ${i + 1} (${test.phase})`
      controller.items.add(vscTest)
    })

    const runner = controller.createTestRunner()
    runner.reflectCurrentTestsStatusInUI()
    runner.dispose()

    return controller
  }

  public createTestRunner (request?: Partial<vscode.TestRunRequest>) {
    const runner = new TestRunner({
      allTests: this.allTests,
      allvscTests: this.allvscTests,
      controller: this,
      output: this.output,
      request: request || {}
    })

    return runner
  }

  public enqueue(runner: TestRunner) {
    this.queue.push(runner)

    if (!this.currentRunner) {
      this.dequeueAndRunUntilEmpty()
    }
  }

  public discoverTests(): Promise<TestItem[]> {
    return this.cmdFromRootProject(async () => {
      const phases = this.phases
      const getTestFrom = (phase: string) => ensureLookupTestsInPhase({
        onMissingLocation: onMissingTestDir,
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
    })

    this.testRun.token.onCancellationRequested(() => {
      this.cancel()
    })

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

    switch (status) {
      case "enqueued":
      case "skipped":
      case "started":
        this.testRun[status](vscTest)
        break
      case "errored":
      case "failed":
        this.testRun[status](vscTest, new vscode.TestMessage("unknown error"))
        break
      case "passed":
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
  console.log(`${JSON.stringify(this)}`)
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
