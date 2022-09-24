import * as vscode from "vscode"
import { join } from "node:path"

export function parseUri(path: string, ...pathSegments: string[]) {
  return vscode.Uri.parse(join(path, ...pathSegments))
}

export function showStopMessage(output: vscode.OutputChannel) {
  return () => output.appendLine("Stopped")
}

export function getUserInput({ title, placeholder, initialValue = "" }: {
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

export function uriFromCurrentWorkspace (...pathSegments: string[]) {
  const currentWorkspaceUri = getCurrentWorkspaceUri()
  return vscode.Uri.joinPath(currentWorkspaceUri, ...pathSegments)
}

export function getCurrentWorkspaceUri() {
  const firstWorkspace = vscode.workspace.workspaceFolders?.[0]!
  const currentFolderUri = firstWorkspace.uri

  return currentFolderUri
}
