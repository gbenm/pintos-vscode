import * as vscode from "vscode"
import { mkdirsSync, removeSync } from "fs-extra"
import { join } from "node:path"
import { ExtConfig } from "./config"
import { clonePintosSnapshot, initPintosProject } from "../core/create"
import { handleError, PintOSExtensionCancellationError } from "./errors"
import { existsSync } from "node:fs"
import { TextEncoder } from "node:util"

export async function createPintosProject (context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
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
    const action = await vscode.window.showInformationMessage("Done!. Good luck!", "open PintOS")

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
    output.appendLine("Stopped")
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

export async function vscInitPintosProject(output: vscode.OutputChannel) {
  await initPintosProject({
    output,
    gitRemote: "testing",
    fileExists(filename) {
      return existsSync(filename)
    },
    removeGitDir(filename) {
      return vscode.workspace.fs.delete(uriFromCurrentWorkspace(filename))
    },
    writeFile(filename, content) {
      return vscode.workspace.fs.writeFile(uriFromCurrentWorkspace(filename), new TextEncoder().encode(content))
    }
  })
}

function getUserInput({ title, placeholder }: {
  title: string
  placeholder: string
}): Promise<string> {
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

function uriFromCurrentWorkspace (...pathSegments: string[]) {
  const currentWorkspaceUri = getCurrentWorkspaceUri()
  return vscode.Uri.joinPath(currentWorkspaceUri, ...pathSegments)
}

function getCurrentWorkspaceUri() {
  const firstWorkspace = vscode.workspace.workspaceFolders?.[0]!
  const currentFolderUri = firstWorkspace.uri

  return currentFolderUri
}
