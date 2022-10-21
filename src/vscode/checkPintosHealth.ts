import * as vscode from "vscode"
import { executeCommand } from "../core/launch"
import { Config } from "./config"
import { getCurrentWorkspaceUri } from "./utils"

export default function (output: vscode.OutputChannel) {
  output.show()
  const terminal = vscode.window.createTerminal("PintOS health")

  try {
    output.appendLine(`current directory ${process.cwd()}`)
    if (Config.buildPintosUtils) {
      executeCommand({
        output,
        cmd: "cd utils && make"
      })
    }
    executeCommand({
      output,
      cmd: "cd threads && make"
    })
    output.appendLine("compiling done!")
    terminal.show()
    terminal.sendText("cd threads", true)

    const workspaceDir = getCurrentWorkspaceUri().fsPath
    const autoCloseCmd = `function waitForEnter () {
      eval $1;
      echo;
      echo 'Press enter to exit' && read && exit;
    }`
    terminal.sendText(autoCloseCmd, true)
    terminal.sendText(`export PATH=\$PATH:${workspaceDir}/utils`, true)
    terminal.sendText("waitForEnter 'pintos --qemu -- -q run alarm-multiple'", true)
  } catch (e) {
    output.appendLine("fail :c")
    throw e
  }
}
