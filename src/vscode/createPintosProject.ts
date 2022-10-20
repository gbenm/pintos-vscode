import * as vscode from "vscode"
import { mkdirsSync, removeSync } from "fs-extra"
import { join as joinPath } from "node:path"
import { Config } from "./config"
import { clonePintosSnapshot, initPintosProject } from "../core/create"
import { executeOrStopOnError } from "./errors"
import { existsSync } from "node:fs"
import { TextEncoder } from "node:util"
import { getCurrentWorkspaceUri, getUserInput, parseUri, pickOptions, showStopMessage } from "./utils"

const stopMessage = "stop PintOS setup"

export default async function (context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  const path = context.globalStorageUri.fsPath
  mkdirsSync(path)

  output.show()

  const tempPath = joinPath(path, "temp")

  let clone = true
  if (existsSync(joinPath(tempPath, ".git"))) {
    const [cloneAgain] = await executeOrStopOnError({
      execute: () =>  pickOptions({
        title: "A pintos snapshot is already cloned",
        options: [
          { label: "Clone again", delete: true },
          { label: "Use it", delete: false }
        ],
        mapFn: op => op.delete
      }),
      message: stopMessage,
      onError: showStopMessage(output)

    })

    if (cloneAgain) {
      removeSync(tempPath)
    } else {
      clone = false
    }
  }

  if (clone) {
    await cloneSnapshot({ output, tempPath })
  }

  const pintosPjUri = await mvPintosCodeToUserInputFolder({ output, tempPath })
  removeSync(tempPath)

  await vscInitPintosProject(pintosPjUri.fsPath, output)

  const action = await vscode.window.showInformationMessage("Done!. Good luck!", "open PintOS")
  if (action === "open PintOS") {
    vscode.commands.executeCommand("vscode.openFolder", pintosPjUri)
  }
}

async function cloneSnapshot({ output, tempPath }: {
  output: vscode.OutputChannel,
  tempPath: string
}) {
  const repoUrl = Config.baseRepository
  const codeFolder = Config.baseRepositoryCodeFolder

  output.appendLine("PintOS start cloning...")
  await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Cloning PintOS repository",
      cancellable: false
    },
    () => clonePintosSnapshot({
      localPath: tempPath,
      repoUrl,
      outputChannel: output,
      codeFolder
    })
  )
  output.appendLine("clone done!")
}

async function mvPintosCodeToUserInputFolder({ output, tempPath }: {
  output: vscode.OutputChannel,
  tempPath: string
}): Promise<vscode.Uri> {
  const currentWorkspaceUri = getCurrentWorkspaceUri()

  const pintosTargetFolder = await executeOrStopOnError({
    execute: () => getUserInput({
      title: "PintOS folder",
      placeholder:  "e.g. pintos"
    }),
    message: stopMessage,
    onError: showStopMessage(output)
  })

  output.appendLine("Start moving the source code")
  const dstUri = vscode.Uri.joinPath(currentWorkspaceUri, pintosTargetFolder)
  await vscode.workspace.fs.rename(
    vscode.Uri.parse(joinPath(tempPath, "src")),
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
      initialValue: Config.personalRepoUrl ?? ""
    }),
    message: stopMessage,
    onError: showStopMessage(output)
  })

  await initPintosProject({
    output,
    pintosPath,
    gitRemote,
    exists(filename) {
      return existsSync(joinPath(pintosPath, filename))
    },
    removeGitDir(filename) {
      return vscode.workspace.fs.delete(parseUri(pintosPath, filename), { recursive: true })
    },
    writeFile(filename, content) {
      return vscode.workspace.fs.writeFile(parseUri(pintosPath, filename), new TextEncoder().encode(content))
    }
  })
}
