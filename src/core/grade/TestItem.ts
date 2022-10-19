import { ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter } from "node:events"
import { dirname, join as joinPath, resolve as resolvePath } from "node:path"
import { Fn, OptionalPromiseLike, OutputChannel } from "../types"
import { iterableForEach, prop } from "../utils/fp/common"
import { or } from "../utils/fp/math"
import { existsfile, rmfile } from "./utils"

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
  public readonly errorsFile: string
  public readonly outputFile: string
  public beforeRun?: BeforeRunEvent = undefined

  private readonly _run: TestRunner
  private _status: TestStatus = "unknown"
  private _prevStatus: TestStatus = "unknown"
  private _backless: boolean = true
  private _prevBackless: boolean = true
  private runBlocked: boolean = false

  private _process?: ChildProcessWithoutNullStreams

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
    beforeRun?: BeforeRunEvent
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
    this.errorsFile = joinPath(dirname(this.resultFile), this.name.concat(".errors"))
    this.outputFile = joinPath(dirname(this.resultFile), this.name.concat(".output"))
    this.beforeRun = test.beforeRun

    this.children.forEach(item => item.on("any", this.onChangeChild.bind(this)))
  }

  public get backless (): boolean {
    if (this.isComposite) {
      return this.children.map(child => child.backless).reduce(or, false)
    }

    return this._backless
  }

  public set backless (value) {
    if (this.isComposite) {
      throw new TestItemStatusFreezeError(`can't change the backless of composite (${this.id})`)
    }
    this._backless = value
    this.backupAndPropagateBacklessChange()
  }

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
    this.backupAndPropagateStatusChange()
  }

  public get isComposite () {
    return this.children.length > 0
  }

  public get process () {
    return this._process
  }

  public set process (process) {
    this.process?.kill()
    this._process = process
  }

  private onChangeChild (item: TestItem, change: unknown, event: TestItemEvent) {
    this.emit(event, item, change)

    if (this.children.includes(item)) {
      if (event === "status") {
        this.backupAndPropagateStatusChange()
      } else if (event === "backless") {
        this.backupAndPropagateBacklessChange()
      }
    }
  }

  private backupAndPropagateStatusChange () {
    const status = this.status
    if (this._prevStatus !== status) {
      this.backupStatus(status)
      this.emit("status", this, status)
    }
  }

  private backupStatus (status: TestStatus) {
    this._prevStatus = status
  }

  private backupAndPropagateBacklessChange () {
    const backless = this.backless
    if (this._prevBackless !== backless) {
      this.backupBackless(backless)
      this.emit("backless", this, backless)
    }
  }

  private backupBackless (backless: boolean) {
    this._prevBackless = backless
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

  public emit (event: TestItemEvent, item: TestItem, change: unknown) {
    super.emit("any", item, change, event)
    return super.emit(event, item, change)
  }

  public async removeFiles () {
    if (this.isComposite) {
      await Promise.all(Array.from(this.testLeafs, test => test.removeFiles()))
    } else {
      await rmfile(this.resultFile)
      await rmfile(this.errorsFile)
      await rmfile(this.outputFile)
    }
  }

  public async existsResultFile (): Promise<boolean> {
    if (this.isComposite) {
      const results = await Promise.all(Array.from(this.testLeafs, test => test.existsResultFile()))
      return results.reduce((a, b) => a && b, true)
    }
    return await existsfile(this.resultFile)
  }

  public async run(output?: OutputChannel): Promise<TestStatus> {
    if (!this.runBlocked) {
      const omit = !await this.beforeRun?.(this, output)
      if (omit && this.beforeRun) {
        return "unknown"
      }
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

  public lookup(
    query: { by: "testid", search: string } | { by: "custom", search: (item: TestItem) => boolean }
  ): TestItem | null {
    if (query.by === "testid"  && (this.gid === query.search || this.id === query.search)) {
      return this
    } else if (query.by === "custom" && query.search(this)) {
      return this
    }

    for (let item of this.children) {
      const result = item.lookup(query)

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
  on(event: "status", listener: (item: TestItem, status: TestStatus) => void): this
  on(event: "backless", listener: (item: TestItem, backless: boolean) => void): this
  on(event: "any", listener: (item: TestItem, change: unknown, event: TestItemEvent) => void): this
  on(event: TestItemEvent, listener: (item: TestItem, change: unknown, event: TestItemEvent) => void): this
  off(event: TestItemEvent, listener: Fn): this

  emit(event: "status", item: TestItem, status: TestStatus): boolean
  emit(event: "backless", item: TestItem, backless: boolean): boolean
  emit(event: "any", item: TestItem, change: unknown): boolean
  emit(event: TestItemEvent, item: TestItem, change: unknown): boolean
}

export type TestItemEvent = "status" | "backless" | "any"

export type TestItemMapper<T, C = any> = (item: TestItem, map: TestItemMapper<T, C>, context: C) => T

export type TestRunner = (item: TestItem, output?: OutputChannel) => OptionalPromiseLike<TestStatus>

export type BeforeRunEvent = (item: TestItem, output?: OutputChannel) => OptionalPromiseLike<boolean>

export type TestStatus = "passed"
  | "failed"
  | "unknown"
  | "enqueued"
  | "errored"
  | "skipped"
  | "started"

/** can't change the status of TestItem */
export class TestItemStatusFreezeError extends Error {}
