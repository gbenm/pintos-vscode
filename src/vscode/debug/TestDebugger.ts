import { ChildProcessWithoutNullStreams } from "child_process"
import * as vscode from "vscode"
import gdbServer from "../../core/debug/gdbServer"
import { TestItem } from "../../core/grade/TestItem"
import { childProcessToPromise, SpawnAbortRequest } from "../../core/launch"
import { promise } from "../../core/utils"
import { executeOrStopOnError, PintOSExtensionCancellationError, PintOSExtensionError } from "../errors"
import { TestController, TestLotProcess } from "../PintosTestController"
import { pickOptions, showStopMessage } from "../utils"
import { pintosGdbConfig } from "./config"
import { setupPintosDebugger } from "../../core/debug/utils"
import { KernelScheduler } from "../../core/launch/types"
import { Config } from "../config"

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

    this.controller.output?.show()
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: `Compiling ${test.phase}`
    }, (_, token) => {

      token.onCancellationRequested(() => this.compilationAbortController!.abort(
        SpawnAbortRequest.of({ error: new PintOSExtensionCancellationError("Canceled compilation") })
      ))

      return this.compile(test)
    })

    setupPintosDebugger()

    const [scheduler] = await executeOrStopOnError({
      message: "Canceled debug session",
      execute: () => pickOptions<{ label: string, value: KernelScheduler }, KernelScheduler>({
        title: "Choose the scheduler",
        options: [
          { label: "PintOS Default Scheduler", value: "default" },
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

  private async startGdbServer (test: TestItem, scheduler: KernelScheduler) {
    this.gdbServer = gdbServer({
      test,
      scheduler,
      shell: this.shell,
      simulator: Config.pintosSimulator
    })

    await childProcessToPromise({
      process: this.gdbServer,
      onData: (buffer: Buffer) => {
        this.controller.output?.append(buffer.toString())
      }
    })

    this.restartServerTimeout = setTimeout(async () => {
      await this.compile(test)
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
