import * as vscode from "vscode"
import checkPintosHealth from "./vscode/checkPintosHealth"
import { Config } from "./vscode/config"
import createPintosProject from "./vscode/createPintosProject"
import PintosTestController from "./vscode/PintosTestController"
import reflectTestsStatusFromResultFiles from "./vscode/reflectTestsStatusFromResultFiles"
import resetTestController from "./vscode/resetTestController"
import setupDevContainer from "./vscode/setupDevContainer"
import { getCurrentWorkspaceUri, createScopedHandler } from "./vscode/utils"

const output = createPintosOutputChannel()

const platformsThatSupportFullCapabilities: NodeJS.Platform[] = ["linux", "darwin"]

export async function activate(context: vscode.ExtensionContext) {
  const workspaceDir = getCurrentWorkspaceUri().fsPath
  process.env.PATH = `${process.env.PATH}:${workspaceDir}/utils`

  const currentTestControllerWrapper = {
    controller: await PintosTestController.create({
      phases: Config.pintosPhases,
      output
    })
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("pintos.createNewProject", createScopedHandler(createPintosProject, context, output)),
    vscode.commands.registerCommand("pintos.setupDevContainer", createScopedHandler(setupDevContainer, output)),
    vscode.commands.registerCommand("pintos.checkHealth", createScopedHandler(checkPintosHealth, output)),
    vscode.commands.registerCommand("pintos.resetTestController", createScopedHandler(resetTestController, context, output, currentTestControllerWrapper)),
    vscode.commands.registerCommand("pintos.reflectTestsStatusFromResultFiles", createScopedHandler(reflectTestsStatusFromResultFiles, currentTestControllerWrapper)),
    currentTestControllerWrapper.controller
  )

  if (platformsThatSupportFullCapabilities.includes(process.platform)) {
    vscode.commands.executeCommand("setContext", "pintos.active", true)
  }
}

function createPintosOutputChannel() {
  const output = vscode.window.createOutputChannel("PintOS")
  return output
}

export function deactivate() {
  output.dispose()
}
