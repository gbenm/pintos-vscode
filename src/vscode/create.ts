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
  const repoUrl = ExtConfig.baseRepository
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
        repoUrl,
        outputChannel: output,
        codeFolder
      })
    )
    output.appendLine("clone done!")
    const pintosPjUri = await mvPintosCodeToUserInputFolder({ output, localPath })

    vscInitPintosProject(pintosPjUri.fsPath, output)

    const action = await vscode.window.showInformationMessage("Done!. Good luck!", "open PintOS")
    if (action === "open PintOS") {
      vscode.commands.executeCommand("vscode.openFolder", pintosPjUri)
    }
  } catch (e) {
    handleError(e)
  }
}

async function mvPintosCodeToUserInputFolder({ output, localPath }: {
  output: vscode.OutputChannel,
  localPath: string
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
    vscode.Uri.parse(join(localPath, "src")),
    dstUri,
    { overwrite: true }
  )
  output.appendLine(`Open ${dstUri.fsPath} to start your project`)
  return dstUri
}

export async function vscInitPintosProject(pintosPath: string, output: vscode.OutputChannel) {
  output.appendLine("start: init project")
  await initPintosProject({
    output,
    pintosPath,
    gitRemote: "testing",
    exists(filename) {
      output.appendLine(join(pintosPath, filename))
      return existsSync(join(pintosPath, filename))
    },
    removeGitDir(filename) {
      output.appendLine(parseUri(pintosPath, filename).toString())
      return vscode.workspace.fs.delete(parseUri(pintosPath, filename), { recursive: true })
    },
    writeFile(filename, content) {
      return vscode.workspace.fs.writeFile(parseUri(pintosPath, filename), new TextEncoder().encode(content))
    }
  })
}

function parseUri(path: string, ...pathSegments: string[]) {
  return vscode.Uri.parse(join(path, ...pathSegments))
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
