import * as vscode from "vscode"
import { Config } from "./config"
import PintosTestController from "./PintosTestController"

export default async (context: vscode.ExtensionContext, output: vscode.OutputChannel, testControllerWrap: { controller: PintosTestController }) => {
  testControllerWrap.controller.dispose()

  const index = context.subscriptions.findIndex(disposable => disposable === testControllerWrap.controller)

  testControllerWrap.controller = await PintosTestController.create({
    phases: Config.pintosPhases,
    output
  })

  context.subscriptions.splice(index, 1, testControllerWrap.controller)
}
