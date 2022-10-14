import * as vscode from "vscode"
import { execSync } from "node:child_process"
import { getCurrentWorkspaceUri, uriFromCurrentWorkspace } from "./utils"
import { handleError } from "./errors"
import { executeCommand } from "../core/launch"

export default async function (output: vscode.OutputChannel) {
  output.show()
  const terminal = vscode.window.createTerminal("PintOS health")

  const cwd = process.cwd()
  try {
    process.chdir(getCurrentWorkspaceUri().fsPath)
    output.appendLine(`current directory ${process.cwd()}`)
    executeCommand({
      output,
      cmd: "cd utils && make"
    })
    executeCommand({
      output,
      cmd: "cd threads && make"
    })
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
