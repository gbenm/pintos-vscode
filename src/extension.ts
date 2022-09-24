// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode"
import { createPintosProject, vscInitPintosProject } from "./vscode/create"

const output = createPintosOutputChannel()

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("pintos.createNewProject", () => {
      // vscode.window.showInformationMessage("Hello World from pintos!")
      // vscode.commands.executeCommand("remote-containers.reopenInContainer")
      createPintosProject(context, output)
    }),
    vscode.commands.registerCommand("pintos.initProject", () => vscInitPintosProject(output))
  )
}

function createPintosOutputChannel() {
  const output = vscode.window.createOutputChannel("PintOS")
  return output
}

export function deactivate() {
  output.dispose()
}
