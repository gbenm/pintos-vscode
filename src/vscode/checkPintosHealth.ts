import * as vscode from "vscode"
import { executeCommand } from "../core/launch"

export default function (output: vscode.OutputChannel) {
  output.show()
  const terminal = vscode.window.createTerminal("PintOS health")

  try {
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
  }
}
