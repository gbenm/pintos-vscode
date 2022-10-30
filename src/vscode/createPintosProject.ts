import * as vscode from "vscode"
import { mkdirsSync, removeSync } from "fs-extra"
import { join as joinPath } from "node:path"
import { Config } from "./config"
import { clonePintosSnapshot, initPintosProject } from "../core/create"
import { executeOrStopOnError } from "./errors"
import { existsSync } from "node:fs"
import { TextEncoder } from "node:util"
import { getCurrentWorkspaceUri, getUserInput, uriFromFile, pickOptions, showStopMessage } from "./utils"

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

  const tempSourceCode = await cloneSnapshot({ output, tempPath, clone })

  const pintosPjUri = await mvPintosCodeToUserInputFolder({ output, codeFolder: tempSourceCode })
  removeSync(tempPath)

  await vscInitPintosProject(pintosPjUri.fsPath, output)

  const action = await vscode.window.showInformationMessage("Done!. Good luck!", "open PintOS")
  if (action === "open PintOS") {
    vscode.commands.executeCommand("vscode.openFolder", pintosPjUri)
  }
}

async function cloneSnapshot({ output, tempPath, clone }: {
  output: vscode.OutputChannel,
  tempPath: string
  clone: boolean
}) {
  let repoUrl: string
  if (clone) {
    repoUrl = await executeOrStopOnError({
      execute: () => getUserInput({
        initialValue: Config.baseRepository,
        title: "Repository to get a code snapshot of PintOS",
        placeholder: "e.g. https://github.com/gbenm/pintos-tuto"
      })
    })
  }

  let codeFolder: string | null = await executeOrStopOnError({
    execute: () => getUserInput({
      initialValue: Config.baseRepositoryCodeFolder,
      title: "The source code folder of pintos in the repository (contains utils/, threads/, etc.). Leave empty if the repository has only the source code of the project",
      placeholder: "e.g. src/",
      required: false
    })
  })

  codeFolder = codeFolder || null

  if (codeFolder === "/") {
    codeFolder = null
  }

  if (clone) {
    output.appendLine("PintOS start cloning...")
    const controller = new AbortController()
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Cloning PintOS repository",
        cancellable: true
      },
      async (progressController, token) => {
        if (token.isCancellationRequested) {
          return
        }

        token.onCancellationRequested(() => {
          controller.abort()
        })

        let lastProgress = 0

        return await executeOrStopOnError({
          message: stopMessage,
          execute: () => clonePintosSnapshot({
            localPath: tempPath,
            repoUrl,
            abort: controller.signal,
            outputChannel: output,
            codeFolder,
            progressHandler({ stage, progress }) {
              const increment = progress - lastProgress
              lastProgress = progress

              progressController.report({
                message: stage,
                increment
              })
            },
          }),
          onError: showStopMessage(output)
        })
      }
    )
    output.appendLine("clone done!")
  }

  return joinPath(tempPath, codeFolder || "")
}

async function mvPintosCodeToUserInputFolder({ output, codeFolder }: {
  output: vscode.OutputChannel,
  codeFolder: string
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
    vscode.Uri.file(codeFolder),
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
      return vscode.workspace.fs.delete(uriFromFile(pintosPath, filename), { recursive: true })
    },
    writeFile(filename, content) {
      return vscode.workspace.fs.writeFile(uriFromFile(pintosPath, filename), new TextEncoder().encode(content))
    }
  })
}
