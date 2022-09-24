import simpleGit from "simple-git"
import * as vscode from "vscode"
import { mkdirsSync, removeSync } from "fs-extra"
import { join } from "path"
import { ExtConfig } from "./config"
import { clonePintosSnapshot } from "../core/create"
import { handleError, PintOSExtensionCancellationError } from "./errors"

export async function setupPintosProject (context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  const path = context.globalStorageUri.fsPath
  mkdirsSync(path)

  output.show()

  const localPath = join(path, "temp")
  const repoPath = ExtConfig.baseRepository
  const codeFolder = ExtConfig.baseRepositoryCodeFolder

  removeSync(localPath)

  try {
    output.appendLine("PintOS start cloning...")
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Cloning PintOS repository",
        cancellable: false
      },
      () => clonePintosSnapshot({
        localPath,
        repoPath,
        outputChannel: output,
        codeFolder
      })
    )
    output.appendLine("clone done!")
    const dstUri = await mvPintosCodeToUserInputFolder({ output, repoPath })
    const action = await vscode.window.showInformationMessage("Setup complete. Good luck!", "open PintOS")

    if (action === "open PintOS") {
      vscode.commands.executeCommand("vscode.openFolder", dstUri)
    }
  } catch (e) {
    handleError(e)
  }
}

async function mvPintosCodeToUserInputFolder({ output, repoPath }: {
  output: vscode.OutputChannel,
  repoPath: string
}): Promise<vscode.Uri> {
  const currentWorkspaceUri = getCurrentWorkspaceUri()

  const pintosTarget = { folder: "" }

  try {
    pintosTarget.folder = await getUserInput({
      title: "PintOS folder",
      placeholder:  "e.g. pintos"
    })
  } catch {
    output.appendLine("Stop setup")
    throw new PintOSExtensionCancellationError()
  }

  output.appendLine("Start moving the source code")
  const dstUri = vscode.Uri.joinPath(currentWorkspaceUri, pintosTarget.folder)
  vscode.workspace.fs.rename(
    vscode.Uri.parse(join(repoPath, "src")),
    dstUri,
    { overwrite: true }
  )
  output.appendLine(`Open ${dstUri.fsPath} to start your project`)
  return dstUri
}

function getUserInput({ title, placeholder }: UserInputArgs): Promise<string> {
  const input = vscode.window.createInputBox()
  input.title = title
  input.placeholder = placeholder
  input.show()

  return new Promise((resolve, reject) => {
    input.onDidAccept(() => {
      if (!input.value.trim()) {
        return
      }

      resolve(input.value.trim())
      input.hide()
    })

    input.onDidHide(reject)
  })
}

interface UserInputArgs {
  title: string
  placeholder: string
}

function getCurrentWorkspaceUri() {
  const firstWorkspace = vscode.workspace.workspaceFolders?.[0]!
  const currentFolderUri = firstWorkspace.uri

  return currentFolderUri
}
