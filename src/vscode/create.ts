import * as vscode from "vscode"
import { mkdirsSync, removeSync } from "fs-extra"
import { join } from "node:path"
import { ExtConfig } from "./config"
import { clonePintosSnapshot, initPintosProject } from "../core/create"
import { executeOrStopOnError, handleError, PintOSExtensionCancellationError } from "./errors"
import { existsSync, writeFileSync } from "node:fs"
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

    await vscInitPintosProject(pintosPjUri.fsPath, output)

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

  const pintosTargetFolder = await executeOrStopOnError({
    execute: () => getUserInput({
      title: "PintOS folder",
      placeholder:  "e.g. pintos"
    }),
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

export async function vscInitPintosProject(pintosPath: string, output: vscode.OutputChannel) {
  output.appendLine("start: init project")

  const gitRemote = await executeOrStopOnError({
    execute: () => getUserInput({
      title: "Your repository",
      placeholder: "e.g. https://github.com/gbenm/pintos-vscode",
      initialValue: ExtConfig.personalRepoUrl ?? ""
    }),
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

function parseUri(path: string, ...pathSegments: string[]) {
  return vscode.Uri.parse(join(path, ...pathSegments))
}

function showStopMessage(output: vscode.OutputChannel) {
  return () => output.appendLine("Stopped")
}

function getUserInput({ title, placeholder, initialValue = "" }: {
  title: string
  placeholder: string
  initialValue?: string
}): Promise<string> {
  const input = vscode.window.createInputBox()
  input.title = title
  input.placeholder = placeholder
  input.value = initialValue
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
