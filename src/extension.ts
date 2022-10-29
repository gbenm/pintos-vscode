import * as vscode from "vscode"
import checkPintosHealth from "./vscode/checkPintosHealth"
import { Config } from "./vscode/config"
import createPintosProject from "./vscode/createPintosProject"
import { addGdbMacrosToPath } from "./vscode/debug/config"
import PintosTestController, { TestRunProfilesBuilders } from "./vscode/PintosTestController"
import reflectTestsStatusFromResultFiles from "./vscode/reflectTestsStatusFromResultFiles"
import resetTestController from "./vscode/resetTestController"
import TestExecuteProfile from "./vscode/run/Profile"
import TestDebugProfile from "./vscode/debug/Profile"
import setupDevContainer from "./vscode/setupDevContainer"
import { getCurrentWorkspaceUri, createScopedHandler, existsInWorkspace } from "./vscode/utils"
import openTestSourceFile from "./vscode/openTestSourceFile"
import { PintosBuildDirsWatcher } from "./vscode/PintosBuildDirsWatcher"
import PintosStatusBar from "./vscode/PintosStatusBar"
import openGradeFile from "./vscode/openGradeFile"

const output = createPintosOutputChannel()

const platformsThatSupportFullCapabilities: NodeJS.Platform[] = ["linux", "darwin"]

export async function activate(context: vscode.ExtensionContext) {
  if (Config.addPintosUtilsToPath) {
    const workspaceDir = getCurrentWorkspaceUri().fsPath
    process.env.PATH = `${process.env.PATH}:${workspaceDir}/utils`
  }

  const currentTestControllerWrap: { controller: PintosTestController | null, dispose: () => void } = {
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
    TestExecuteProfile.create,
    TestDebugProfile.create
  ]

  const buildDirsFsWatcher = new PintosBuildDirsWatcher(Config.pintosPhases)

  if (pintosSupported) {
    currentTestControllerWrap.controller = await PintosTestController.create({
      phases: Config.pintosPhases,
      context,
      output,
      buildDirsFsWatcher,
      profilesBuilders: testRunProfilesBuilders
    })
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("pintos.createNewProject", createScopedHandler(createPintosProject, context, output)),
    vscode.commands.registerCommand("pintos.setupDevContainer", createScopedHandler(setupDevContainer, output)),
    vscode.commands.registerCommand("pintos.checkHealth", createScopedHandler(checkPintosHealth, output)),
    vscode.commands.registerCommand("pintos.openGradeFileOf", createScopedHandler(openGradeFile)),
    await PintosStatusBar.create({
      buildDirsFsWatcher,
      phases: Config.pintosPhases
    })
  )

  if (hasActiveTestController(currentTestControllerWrap)) {
    addGdbMacrosToPath()
    context.subscriptions.push(
      vscode.commands.registerCommand("pintos.resetTestController", createScopedHandler(resetTestController, context, output, currentTestControllerWrap, testRunProfilesBuilders, buildDirsFsWatcher)),
      vscode.commands.registerCommand("pintos.reflectTestsStatusFromResultFiles", createScopedHandler(reflectTestsStatusFromResultFiles, currentTestControllerWrap)),
      currentTestControllerWrap,
      vscode.commands.registerCommand("pintos.openResourceTestFile", createScopedHandler(openTestSourceFile, { controllerWrap: currentTestControllerWrap }))
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
