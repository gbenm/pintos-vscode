import { existsSync } from "fs"
import { TextEncoder } from "util"
import * as vscode from "vscode"
import { setupDevContainer } from "../core/containers"
import { handleError } from "./errors"
import { uriFromCurrentWorkspace } from "./utils"

export default async function (output: vscode.OutputChannel) {
  output.show()
  output.appendLine("Start setup Dev Container")

  await setupDevContainer({
    output,
    exists(filename) {
      return existsSync(uriFromCurrentWorkspace(filename).fsPath)
    },
    mkdir(folderName) {
      return vscode.workspace.fs.createDirectory(uriFromCurrentWorkspace(folderName))
    },
    writeFile(filename, content) {
      return vscode.workspace.fs.writeFile(uriFromCurrentWorkspace(filename), new TextEncoder().encode(content))
    }
  })
}
