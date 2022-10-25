import { TestRunRequest } from "vscode"
import { TestController, TestLotProcess, TestRunProfile } from "../PintosTestController"
import TestRunner from "./TestRunner"

export default class TestExecuteProfile extends TestRunProfile {
  private constructor (controller: TestController) {
    super({
      label: "Execute test profile",
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
