import { ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter } from "node:events"
import { dirname, join as joinPath } from "node:path"
import { Fn, OptionalPromiseLike, OutputChannel } from "../types"
import { iterableForEach, prop, waitMap } from "../utils/fp/common"
import { and, or } from "../utils/fp/math"
import { existsfile, rmfile } from "./utils"

export const finalStates: TestStatus[] = ["errored", "failed", "passed", "skipped", "unknown"]

export class TestItem<T = any> extends EventEmitter implements Iterable<TestItem<T>> {
  public readonly id: string
  public readonly gid: string
  public readonly basePath: string
  public readonly phase: string
  public readonly name: string
  public readonly children: readonly TestItem<T>[]
  public data: T

  public readonly makefileTarget: string
  public readonly resultFile: string
  public readonly errorsFile: string
  public readonly outputFile: string
  public beforeRun?: BeforeRunEvent<T> = undefined

  private readonly _run: TestRunner<T>
  private _status: TestStatus
  private _prevStatus: TestStatus
  private _backless: boolean
  private _prevBackless: boolean
  private runBlocked: boolean = false

  private _process?: ChildProcessWithoutNullStreams

  constructor (test: {
    id: string
    gid?: string
    basePath: string
    name: string
    phase: string
    children: readonly TestItem<T>[]
    run: TestRunner<T>
    dataBuilder: TestDataBuilder<T>
    makefileTarget: string
    resultFile: string
    beforeRun?: BeforeRunEvent<T>
    backless?: boolean
    status?: TestStatus
  }) {
    super()
    this._run = test.run
    this.id = test.id
    this.gid = test.gid || `%${test.phase}%${test.id}`
    this.basePath = test.basePath
    this.name = test.name
    this.children = test.children
    this.phase = test.phase
    this.makefileTarget = test.makefileTarget
    this.resultFile = test.resultFile
    this.errorsFile = joinPath(dirname(this.resultFile), this.name.concat(".errors"))
    this.outputFile = joinPath(dirname(this.resultFile), this.name.concat(".output"))
    this.beforeRun = test.beforeRun
    this._status = test.status || "unknown"
    this._prevStatus = this._status
    this._backless = typeof test.backless === "boolean" ? test.backless : true
    this._prevBackless = this._backless

    this.children.forEach(item => item.on("any", this.onChangeChild.bind(this)))

    // Must execute after all
    this.data = test.dataBuilder(this)
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

  private onChangeChild (item: TestItem<T>, change: unknown, event: TestItemEvent) {
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

  public emit (event: TestItemEvent, item: TestItem<T>, change: unknown) {
    super.emit("any", item, change, event)
    return super.emit(event, item, change)
  }

  public async removeFiles (): Promise<boolean> {
    let results: boolean[]
    if (this.isComposite) {
      results = await Promise.all(Array.from(this.testLeafs, test => test.removeFiles()))
    } else {
      const toRemove = [this.resultFile, this.errorsFile, this.outputFile]
      results = await waitMap(async (file) => {
        try {
          await rmfile(file)
          return true
        } catch {
          return false
        }
      }, toRemove)
    }

    return results.reduce(and, true)
  }

  public async existsResultFile (): Promise<boolean> {
    if (this.isComposite) {
      const results = await Promise.all(Array.from(this.testLeafs, test => test.existsResultFile()))
      return results.reduce((a, b) => a && b, true)
    }
    return await existsfile(this.resultFile)
  }

  public async run(context: {
    output?: OutputChannel
    [metadata: string]: unknown
  } = {}): Promise<TestStatus> {
    if (!this.runBlocked) {
      const request = {
        item: this,
        ...context
      }
      const omit = !await this.beforeRun?.(request)
      if (omit && this.beforeRun) {
        return "unknown"
      }
      return await this._run(request)
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
    query: { by: "testid", search: string } | { by: "custom", search: (item: TestItem<T>) => boolean }
  ): TestItem<T> | null {
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

  public map<R, C = undefined>(fn: TestItemMapper<R, T, C>): R
  public map<R, C = any>(fn: TestItemMapper<R, T, C>, context: C): R
  public map<R, C = any>(fn: TestItemMapper<R, T, C>, context?: C): R {
    return fn(this, fn, <C> context)
  }

  public static createMapper<I, T = any, C = any>(fn: TestItemMapper<I, T, C>): TestItemMapper<I, T, C> {
    return fn
  }

  /** Returns an iterable of all children who are leaves (not composite) */
  public get testLeafs(): Iterable<TestItem<T>> {
    return {
      [Symbol.iterator]: this.testLeafsIterator.bind(this)
    }
  }

  private *testLeafsIterator(): Iterator<TestItem<T>> {
    if (this.isComposite) {
      for (let item of this.children) {
        yield* item.testLeafs
      }
    } else {
      yield this
    }
  }

  *[Symbol.iterator](): Iterator<TestItem<T>> {
    yield this
    for (let item of this.children) {
      yield* item
    }
  }
}

export declare interface TestItem<T> {
  on(event: "status", listener: (item: TestItem<T>, status: TestStatus) => void): this
  on(event: "backless", listener: (item: TestItem<T>, backless: boolean) => void): this
  on(event: "any", listener: (item: TestItem<T>, change: unknown, event: TestItemEvent) => void): this
  on(event: TestItemEvent, listener: (item: TestItem<T>, change: unknown, event: TestItemEvent) => void): this
  off(event: TestItemEvent, listener: Fn): this

  emit(event: "status", item: TestItem<T>, status: TestStatus): boolean
  emit(event: "backless", item: TestItem<T>, backless: boolean): boolean
  emit(event: "any", item: TestItem<T>, change: unknown): boolean
  emit(event: TestItemEvent, item: TestItem<T>, change: unknown): boolean
}

export type TestItemEvent = "status" | "backless" | "any"

export type TestItemMapper<T, I = any, C = any> = (item: TestItem<I>, map: TestItemMapper<T, I, C>, context: C) => T

export type TestRunner<T = any> = (request: TestRunRequest<T>) => OptionalPromiseLike<TestStatus>

export type BeforeRunEvent<T = any> = (request: TestRunRequest<T>) => OptionalPromiseLike<boolean>

export interface TestRunRequest<T = any> {
  item: TestItem<T>,
  output?: OutputChannel
  [metadata: string]: unknown
}

export type TestStatus = "passed"
  | "failed"
  | "unknown"
  | "enqueued"
  | "errored"
  | "skipped"
  | "started"

/** can't change the status of TestItem */
export class TestItemStatusFreezeError extends Error {}

export type TestDataBuilder<T> = (test: Readonly<TestItem<T>>) => T
