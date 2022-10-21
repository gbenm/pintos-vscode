import * as vscode from "vscode"
import { Config } from "./config"
import PintosTestController from "./PintosTestController"

export default async (context: vscode.ExtensionContext, output: vscode.OutputChannel, testControllerWrapper: { controller: PintosTestController }) => {
  testControllerWrapper.controller.dispose()

  testControllerWrapper.controller = await PintosTestController.create({
    phases: Config.pintosPhases,
    output,
    context
  })
}
