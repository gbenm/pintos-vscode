import * as vscode from "vscode"
import { Config } from "./config"
import { PintosBuildDirsWatcher } from "./PintosBuildDirsWatcher"
import PintosTestController, { TestRunProfilesBuilders } from "./PintosTestController"

export default async (context: vscode.ExtensionContext, output: vscode.OutputChannel, testControllerWrapper: { controller: PintosTestController }, profilesBuilders: TestRunProfilesBuilders, buildDirsFsWatcher: PintosBuildDirsWatcher) => {
  testControllerWrapper.controller.dispose()

  testControllerWrapper.controller = await PintosTestController.create({
    phases: Config.pintosPhases,
    output,
    context,
    profilesBuilders,
    buildDirsFsWatcher
  })
}
