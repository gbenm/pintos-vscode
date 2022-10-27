import * as vscode from "vscode"
import { TestItem } from "../../core/grade/TestItem"
import { childProcessToPromise } from "../../core/launch"
import { TestController, TestLotProcess } from "../PintosTestController"

export default class TestRunner extends TestLotProcess {
  private compiledPhases: string[] = []

  constructor (args: {
    request: Partial<vscode.TestRunRequest>
    controller: TestController
  }) {
    super({ ...args, label: "runner" })
  }

  protected async execute(test: TestItem<vscode.TestItem>): Promise<void> {
    await this.compileIfNeeded(test)

    await test.run({
      output: this.controller.output,
      runningTestid: test.gid,
      shell: this.shell
    })
  }

  private async compileIfNeeded (test: TestItem) {
    if (!this.compiledPhases.includes(test.phase)) {
      this.controller.output?.appendLine(`[make] compile ${test.name}\n`)
      await childProcessToPromise({
        process: this.shell.make({
          cwd: test.phase,
          args: []
        }),
        onData: (buffer: Buffer) => {
          this.controller.output?.append(buffer.toString())
        }
      })
      this.controller.output?.appendLine("")

      this.compiledPhases.push(test.phase)
    }
  }
}
