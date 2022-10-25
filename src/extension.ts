import * as vscode from "vscode"
import checkPintosHealth from "./vscode/checkPintosHealth"
import { Config } from "./vscode/config"
import createPintosProject from "./vscode/createPintosProject"
import PintosTestController, { TestRunProfilesBuilders } from "./vscode/PintosTestController"
import reflectTestsStatusFromResultFiles from "./vscode/reflectTestsStatusFromResultFiles"
import resetTestController from "./vscode/resetTestController"
import ExecuteTestProfile from "./vscode/run/ExecuteTestProfile"
import setupDevContainer from "./vscode/setupDevContainer"
import { getCurrentWorkspaceUri, createScopedHandler, uriFromCurrentWorkspace, existsInWorkspace } from "./vscode/utils"

const output = createPintosOutputChannel()

const platformsThatSupportFullCapabilities: NodeJS.Platform[] = ["linux", "darwin"]

export async function activate(context: vscode.ExtensionContext) {
  if (Config.addPintosUtilsToPath) {
    const workspaceDir = getCurrentWorkspaceUri().fsPath
    process.env.PATH = `${process.env.PATH}:${workspaceDir}/utils`
  }

  const currentTestControllerWrapper: { controller: PintosTestController | null, dispose: () => void } = {
    controller: null,
    dispose () {
      this.controller?.dispose()
    }
  }

  vscode.commands.executeCommand("setContext", "pintos.active", true)

  const pintosUtil = await existsInWorkspace("utils", "pintos")
  const pintosSupported = pintosUtil && platformsThatSupportFullCapabilities.includes(process.platform)

  vscode.commands.executeCommand("setContext", "pintos.supported", pintosSupported)

  const testRunProfilesBuilders: TestRunProfilesBuilders = [
    ExecuteTestProfile.create
  ]

  if (pintosSupported) {
    currentTestControllerWrapper.controller = await PintosTestController.create({
      phases: Config.pintosPhases,
      context,
      output,
      profilesBuilders: testRunProfilesBuilders
    })
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("pintos.createNewProject", createScopedHandler(createPintosProject, context, output)),
    vscode.commands.registerCommand("pintos.setupDevContainer", createScopedHandler(setupDevContainer, output)),
    vscode.commands.registerCommand("pintos.checkHealth", createScopedHandler(checkPintosHealth, output))
  )

  if (hasActiveTestController(currentTestControllerWrapper)) {
    context.subscriptions.push(
      vscode.commands.registerCommand("pintos.resetTestController", createScopedHandler(resetTestController, context, output, currentTestControllerWrapper, testRunProfilesBuilders)),
      vscode.commands.registerCommand("pintos.reflectTestsStatusFromResultFiles", createScopedHandler(reflectTestsStatusFromResultFiles, currentTestControllerWrapper)),
      currentTestControllerWrapper
    )
  }
}

function hasActiveTestController (wrapper: any): wrapper is { controller: PintosTestController } {
  return wrapper && wrapper.controller instanceof PintosTestController
}

function createPintosOutputChannel() {
  const output = vscode.window.createOutputChannel("PintOS")
  return output
}

export function deactivate() {
  output.dispose()
}
