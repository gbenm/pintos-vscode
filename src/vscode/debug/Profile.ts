import * as vscode from "vscode"
import { TestRunRequest } from "vscode"
import { PintOSExtensionError } from "../errors"
import { TestController, TestLotProcess, TestRunProfile } from "../PintosTestController"
import TestDebugger from "./TestDebugger"

export default class TestDebugProfile extends TestRunProfile {
  private constructor (controller: TestController) {
    super({
      label: "debug test profile",
      kind: vscode.TestRunProfileKind.Debug,
      controller
    })
  }

  createProcess(request: TestRunRequest): TestLotProcess {
    if (!request.include || request.include.length > 1) {
      throw new PintOSExtensionError("can't debug multiple files")
    }

    return new TestDebugger({
      request,
      controller: this.controller
    })
  }

  static create(controller: TestController) {
    return new TestDebugProfile(controller)
  }
}
