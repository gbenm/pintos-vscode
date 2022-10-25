import * as vscode from "vscode"
import { TestRunRequest } from "vscode"
import { TestController, TestLotProcess, TestRunProfile } from "../PintosTestController"
import TestRunner from "./TestRunner"

export default class TestExecuteProfile extends TestRunProfile {
  private constructor (controller: TestController) {
    super({
      label: "Execute test profile",
      kind: vscode.TestRunProfileKind.Run,
      isDefault: true,
      controller
    })
  }

  createProcess(request: TestRunRequest): TestLotProcess {
    const runner = new TestRunner({
      controller: this.controller,
      request
    })

    return runner
  }

  static create (controller: TestController) {
    return new TestExecuteProfile(controller)
  }
}
