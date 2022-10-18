import { ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter } from "node:events"
import { join as joinPath, resolve as resolvePath } from "node:path"
import { OptionalPromiseLike, OutputChannel } from "../types"
import { iterableForEach, prop } from "../utils/fp/common"

export const finalStates: TestStatus[] = ["errored", "failed", "passed", "skipped", "unknown"]

export class TestItem extends EventEmitter implements Iterable<TestItem> {
  public readonly id: string
  public readonly gid: string
  public readonly basePath: string
  public readonly phase: string
  public readonly name: string
  public readonly children: readonly TestItem[]

  public readonly makefileTarget: string
  public readonly resultFile: string

  private readonly _run: TestRunner
  private _status: TestStatus = "unknown"
  private _prevStatus: TestStatus = "unknown"
  private runBlocked: boolean = false

  public get status () {
    if (this.isComposite) {
      return this.statusBaseOnChildren()
    }

    return this._status
  }

  public set status (value: TestStatus) {
    if (this.isComposite) {
      throw new TestItemStatusFreezeError(`can't change the status of composite (${this.id})`)
    }
    this._status = value
    this.backupAndPropagateChange()
  }

  public get isComposite () {
    return this.children.length > 0
  }

  private _process?: ChildProcessWithoutNullStreams

  public get process () {
    return this._process
  }

  public set process (process) {
    this.process?.kill()
    this._process = process
  }

  constructor (test: {
    id: string
    gid?: string
    basePath: string
    name: string
    phase: string
    children: readonly TestItem[]
    run: TestRunner
    makefileTarget?: string
    resultFile?: string
  }) {
    super()
    this._run = test.run
    this.id = test.id
    this.gid = test.gid || `%${test.phase}%${test.id}`
    this.basePath = test.basePath
    this.name = test.name
    this.children = test.children
    this.phase = test.phase
    this.makefileTarget = test.makefileTarget || joinPath(test.basePath, test.name.concat(".result"))
    this.resultFile = test.resultFile || resolvePath(this.makefileTarget)

    this.children.forEach(item => item.on("status", this.onChangeChildStatus.bind(this)))
  }

  private onChangeChildStatus (item: TestItem) {
    this.emit("status", item)

    if (this.children.includes(item)) {
      this.backupAndPropagateChange()
    }
  }

  private backupStatus () {
    this._prevStatus = this.status
  }

  private backupAndPropagateChange () {
    const status = this.status
    if (this._prevStatus !== status) {
      this.backupStatus
      this.emit("status", this)
    }
  }

  private statusBaseOnChildren () {
    const status = this.children.map(prop("status")).reduce((currentStatus, itemStatus) => {
      const loadingStatus: TestStatus[] = ["enqueued", "started"]
      if (currentStatus === "started") {
        return "started"
      }

      if (loadingStatus.includes(itemStatus)) {
        return itemStatus
      }

      const highStatus: TestStatus[] = ["errored", "failed", ...loadingStatus]
      if (highStatus.includes(currentStatus)) {
        return currentStatus
      }

      return itemStatus
    }, "unknown")

    return status
  }

  public async run(output?: OutputChannel): Promise<TestStatus> {
    if (!this.runBlocked) {
      return await this._run(this, output)
    } else {
      this.runBlocked = false
      return "unknown"
    }
  }

  public stop(signal: NodeJS.Signals = "SIGTERM"): boolean {
    let killed = false

    if (!this.process && this.isComposite) {
      killed = this.children.map(item => item.stop(signal)).reduce((acc, success) => acc && success, true)
    } else if (this.process) {
      killed = this.process.kill(signal)
    } else {
      this.runBlocked = true
      killed = true
    }

    if (this.isComposite) {
      iterableForEach(item => item.status = "unknown", this.testLeafs, test => finalStates.includes(test.status))
    } else {
      this.status = "unknown"
    }

    return killed
  }

  public lookup(testId: string | null): TestItem | null {
    if (this.id === testId || this.gid === testId) {
      return this
    }

    for (let item of this.children) {
      const result = item.lookup(testId)

      if (result) {
        return result
      }
    }

    return null
  }

  public map<T, C = undefined>(fn: TestItemMapper<T, C>): T
  public map<T, C = any>(fn: TestItemMapper<T, C>, context: C): T
  public map<T, C = any>(fn: TestItemMapper<T, C>, context?: C): T {
    return fn(this, fn, <C> context)
  }

  public static createMapper<T, C = any>(fn: TestItemMapper<T, C>): TestItemMapper<T, C> {
    return fn
  }

  /** Returns an iterable of all children who are leaves (not composite) */
  public get testLeafs(): Iterable<TestItem> {
    return {
      [Symbol.iterator]: this.testLeafsIterator.bind(this)
    }
  }

  private *testLeafsIterator(): Iterator<TestItem> {
    if (this.isComposite) {
      for (let item of this.children) {
        yield* item.testLeafs
      }
    } else {
      yield this
    }
  }

  *[Symbol.iterator](): Iterator<TestItem> {
    yield this
    for (let item of this.children) {
      yield* item
    }
  }
}

export declare interface TestItem {
  on(event: TestItemEvent, listener: (item: TestItem) => void): this
  off(event: TestItemEvent, listener: (item: TestItem) => void): this
  emit(event: TestItemEvent, item: TestItem): boolean
}

export type TestItemEvent = "status"

export type TestItemMapper<T, C = any> = (item: TestItem, map: TestItemMapper<T, C>, context: C) => T

export type TestRunner = (item: TestItem, output?: OutputChannel) => OptionalPromiseLike<TestStatus>

export type TestStatus = "passed"
  | "failed"
  | "unknown"
  | "enqueued"
  | "errored"
  | "skipped"
  | "started"

/** can't change the status of TestItem */
export class TestItemStatusFreezeError extends Error {}
