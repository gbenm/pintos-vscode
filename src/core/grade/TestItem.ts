import { ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter } from "node:events"
import { OptionalPromiseLike } from "../types"
import { prop } from "../utils/fp/common"

export class TestItem extends EventEmitter implements Iterable<TestItem> {
  public readonly id: string
  public readonly basePath: string
  public readonly phase: string
  public readonly name: string
  public readonly items: readonly TestItem[]

  private readonly _run: TestRunner
  private _status: TestStatus = "unknown"

  public get status () {
    if (this.isComposite) {
      return this.statusBaseOnChildren()
    }

    return this._status
  }

  public set status (value: TestStatus) {
    if (this.isComposite) {
      throw new TestItemStatusFreezeError("can't change the status of composite")
    }
    this._status = value
    this.emit("status", this)
  }

  public get isComposite () {
    return this.items.length > 0
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
    basePath: string
    name: string
    phase: string
    items: readonly TestItem[]
    run: TestRunner
  }) {
    super()
    this._run = test.run
    this.id = test.id
    this.basePath = test.basePath
    this.name = test.name
    this.items = test.items
    this.phase = test.phase

    this.items.forEach(item => item.on("status", this.onChangeChildStatus.bind(this)))
  }

  private onChangeChildStatus (item: TestItem) {
    this.emit("status", item)

    if (this.items.includes(item)) {
      this.emit("status", this)
    }
  }

  private statusBaseOnChildren () {
    const currentStatus = this.items.map(prop("status")).reduce((currentStatus, itemStatus) => {
      const loadingStatus: TestStatus[] = ["queued", "started"]
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

    return currentStatus
  }

  public async run(): Promise<TestStatus> {
    this.status = await this._run(this)
    return this.status
  }

  public stop(): boolean {
    this.status = "unknown"
    if (this.process) {
      return this.process.kill()
    }

    if (this.items.length > 0) {
      return this.items.map(item => item.stop()).reduce((acc, success) => acc && success, true)
    }

    return false
  }

  public lookup(testId: string | null): TestItem | null {
    if (this.id === testId) {
      return this
    }

    for (let item of this.items) {
      const result = item.lookup(testId)

      if (result) {
        return result
      }
    }

    return null
  }

  *[Symbol.iterator](): Iterator<TestItem> {
    yield this
    for (let item of this.items) {
      yield* item
    }
  }
}

export declare interface TestItem {
  on(event: TestItemEvent, listener: (item: TestItem) => void): this
  emit(event: TestItemEvent, item: TestItem): boolean
}

export type TestItemEvent = "status"

export type TestRunner = (item: TestItem) => OptionalPromiseLike<TestStatus>

export type TestStatus = "passed"
  | "failed"
  | "unknown"
  | "queued"
  | "errored"
  | "skipped"
  | "started"

/** can't change the status of TestItem */
export class TestItemStatusFreezeError extends Error {}
