import * as vscode from "vscode"
import { execSync } from "node:child_process"
import { getCurrentWorkspaceUri, uriFromCurrentWorkspace } from "./utils"
import { handleError } from "./errors"

export default async function (output: vscode.OutputChannel) {
  output.show()
  const terminal = vscode.window.createTerminal("PintOS health")

  const cwd = process.cwd()
  try {
    process.chdir(getCurrentWorkspaceUri().fsPath)
    output.appendLine(`current directory ${process.cwd()}`)
    executeCommand(output, "cd utils && make")
    executeCommand(output, "cd threads && make")
    output.appendLine("compiling done!")
    terminal.show()
    terminal.sendText("cd threads", true)
    terminal.sendText("pintos --qemu -- -q run alarm-multiple && echo 'Press enter to exit' && read && exit", true)
  } catch (e) {
    output.appendLine("fail :c")
    handleError(e)
  } finally {
    process.chdir(cwd)
  }
}

function executeCommand(output: vscode.OutputChannel, cmd: string) {
  output.appendLine(`[start] ${cmd}`)
  execSync(cmd)
  output.appendLine(`[complete] ${cmd}`)
}
