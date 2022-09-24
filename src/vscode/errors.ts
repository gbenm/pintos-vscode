import * as vscode from "vscode"

export function handleError (error: unknown, errorMessage = "An unknown error occurred") {
  if (error instanceof PintOSExtensionError) {
    vscode.window.showErrorMessage(error.message)
  } else if (error instanceof PintOSExtensionCancellationError) {
    vscode.window.showErrorMessage(error.message ?? "Canceled Action")
  } else if (error instanceof Error) {
    const thenable = vscode.window.showErrorMessage(errorMessage, "show stacktrace")
    thenable.then((value) => {
      if (value === "show stacktrace") {
        vscode.window.showErrorMessage(`[${error.message}] ${error.stack ?? ""}`)
      }
    })
  } else {
    vscode.window.showErrorMessage(`${error}`)
  }
}

export class PintOSExtensionError extends Error {}

export class PintOSExtensionCancellationError extends Error {}
