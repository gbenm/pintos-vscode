import * as vscode from "vscode"
import { mkdirsSync, removeSync } from "fs-extra"
import { join } from "node:path"
import { ExtConfig } from "./config"
import { clonePintosSnapshot, initPintosProject } from "../core/create"
import { executeOrStopOnError, handleError } from "./errors"
import { existsSync } from "node:fs"
import { TextEncoder } from "node:util"
import { getCurrentWorkspaceUri, getUserInput, parseUri, showStopMessage } from "./utils"

export default async function (context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  const path = context.globalStorageUri.fsPath
  mkdirsSync(path)

  output.show()

  const localPath = join(path, "temp")
  const repoUrl = ExtConfig.baseRepository
  const codeFolder = ExtConfig.baseRepositoryCodeFolder

  removeSync(localPath)

  output.appendLine("PintOS start cloning...")
  await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Cloning PintOS repository",
      cancellable: false
    },
    () => clonePintosSnapshot({
      localPath,
      repoUrl,
      outputChannel: output,
      codeFolder
    })
  )
  output.appendLine("clone done!")
  const pintosPjUri = await mvPintosCodeToUserInputFolder({ output, localPath })

  await vscInitPintosProject(pintosPjUri.fsPath, output)

  const action = await vscode.window.showInformationMessage("Done!. Good luck!", "open PintOS")
  if (action === "open PintOS") {
    vscode.commands.executeCommand("vscode.openFolder", pintosPjUri)
  }
}

async function mvPintosCodeToUserInputFolder({ output, localPath }: {
  output: vscode.OutputChannel,
  localPath: string
}): Promise<vscode.Uri> {
  const currentWorkspaceUri = getCurrentWorkspaceUri()

  const pintosTargetFolder = await executeOrStopOnError({
    execute: () => getUserInput({
      title: "PintOS folder",
      placeholder:  "e.g. pintos"
    }),
    message: "stop PintOS setup",
    onError: showStopMessage(output)
  })

  output.appendLine("Start moving the source code")
  const dstUri = vscode.Uri.joinPath(currentWorkspaceUri, pintosTargetFolder)
  await vscode.workspace.fs.rename(
    vscode.Uri.parse(join(localPath, "src")),
    dstUri,
    { overwrite: true }
  )
  output.appendLine(`Open ${dstUri.fsPath} to start your project`)
  return dstUri
}

async function vscInitPintosProject(pintosPath: string, output: vscode.OutputChannel) {
  output.appendLine("start: init project")

  const gitRemote = await executeOrStopOnError({
    execute: () => getUserInput({
      title: "Your repository",
      placeholder: "e.g. https://github.com/gbenm/pintos-vscode",
      initialValue: ExtConfig.personalRepoUrl ?? ""
    }),
    message: "stop PintOS setup",
    onError: showStopMessage(output)
  })

  await initPintosProject({
    output,
    pintosPath,
    gitRemote,
    exists(filename) {
      return existsSync(join(pintosPath, filename))
    },
    removeGitDir(filename) {
      return vscode.workspace.fs.delete(parseUri(pintosPath, filename), { recursive: true })
    },
    writeFile(filename, content) {
      return vscode.workspace.fs.writeFile(parseUri(pintosPath, filename), new TextEncoder().encode(content))
    }
  })
}
