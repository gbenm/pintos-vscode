import { ChildProcessWithoutNullStreams } from "child_process"
import * as vscode from "vscode"
import gdbServer from "../../core/debug/gdbServer"
import { TestItem } from "../../core/grade/TestItem"
import { childProcessToPromise } from "../../core/launch"
import { promise } from "../../core/utils"
import { executeOrStopOnError, PintOSExtensionError } from "../errors"
import { TestController, TestLotProcess } from "../PintosTestController"
import { pickOptions, showStopMessage } from "../utils"
import { pintosGdbConfig } from "./config"

export default class TestDebugger extends TestLotProcess {
  private gdbServer?: ChildProcessWithoutNullStreams
  private restartServerTimeout?: NodeJS.Timeout

  constructor (args: {
    request: Partial<vscode.TestRunRequest>
    controller: TestController
  }) {
    super({ label: "debugger", ...args })
  }

  public canWait(): boolean {
    vscode.window.showWarningMessage("You can't start a debug session if the Test Controller is busy")
    return false
  }

  protected async execute(test: TestItem<vscode.TestItem>): Promise<void> {
    if (test.isComposite) {
      throw new PintOSExtensionError("Can't debug a composite test")
    }

    const [scheduler] = await executeOrStopOnError({
      message: "Canceled debug session",
      execute: () => pickOptions<{ label: string, value: "priority" | "mlfqs" }, "priority" | "mlfqs">({
        title: "Choose the scheduler",
        options: [
          { label: "Priority Scheduler", value: "priority" },
          { label: "MLFQS", value: "mlfqs" }
        ],
        mapFn: option => option.value
      }),
      onError: showStopMessage(this.controller.output)
    })

    this.controller.output?.appendLine("[start] Pintos gdb server")
    this.startGdbServer(test, scheduler)

    const started = await vscode.debug.startDebugging(
      undefined,
      pintosGdbConfig({ phase: test.phase })
    )

    if (!started) {
      throw new PintOSExtensionError("Can't start debugger")
    }

    return promise(
      resolve => vscode.debug.onDidTerminateDebugSession(async () => {
        clearTimeout(this.restartServerTimeout)
        await vscode.debug.stopDebugging()
        this.controller.output?.show()
        resolve()
      })
    )
  }

  private async startGdbServer (test: TestItem, scheduler: "priority" | "mlfqs") {
    this.gdbServer = gdbServer({
      test,
      scheduler
    })

    await childProcessToPromise({
      process: this.gdbServer,
      onData: (buffer: Buffer) => {
        this.controller.output?.append(buffer.toString())
      }
    })

    this.restartServerTimeout = setTimeout(() => {
      this.controller.output?.appendLine("[restart] Pintos gdb server")
      this.startGdbServer(test, scheduler)
    }, 1000)
  }

  dispose(): void {
    this.gdbServer?.kill()
    clearTimeout(this.restartServerTimeout)
    super.dispose()
  }
}
