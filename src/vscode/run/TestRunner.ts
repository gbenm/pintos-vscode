import * as vscode from "vscode"
import { TestItem } from "../../core/grade/TestItem"
import { TestController, TestLotProcess } from "../PintosTestController"

export default class TestRunner extends TestLotProcess {
  constructor (args: {
    request: Partial<vscode.TestRunRequest>
    controller: TestController
  }) {
    super({ ...args, label: "runner" })
  }

  protected async execute(test: TestItem<vscode.TestItem>): Promise<void> {
    await test.run({
      output: this.controller.output,
      runningTestid: test.gid
    })
  }
}
