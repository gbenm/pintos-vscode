// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode"
import checkPintosHealth from "./vscode/checkPintosHealth"
import createPintosProject from "./vscode/createPintosProject"
import PintosTestController from "./vscode/PintosTestController"
import setupDevContainer from "./vscode/setupDevContainer"
import { getCurrentWorkspaceUri } from "./vscode/utils"

const output = createPintosOutputChannel()

export async function activate(context: vscode.ExtensionContext) {
  // This commands will use for container API
  // vscode.commands.executeCommand("remote-containers.reopenInContainer")

  context.subscriptions.push(
    vscode.commands.registerCommand("pintos.createNewProject", () => createPintosProject(context, output)),
    vscode.commands.registerCommand("pintos.setupDevContainer", () => setupDevContainer(output)),
    vscode.commands.registerCommand("pintos.checkHealth", () => checkPintosHealth(output)),
  )
  vscode.commands.executeCommand("setContext", "pintos.active", true)

  const workspaceDir = getCurrentWorkspaceUri().fsPath
  process.env.PATH = `${process.env.PATH}:${workspaceDir}/utils`
  await PintosTestController.create({
    phases: ["threads", "userprog", "vm", "filesys"],
    output
  })
}

function createPintosOutputChannel() {
  const output = vscode.window.createOutputChannel("PintOS")
  return output
}

export function deactivate() {
  output.dispose()
}
