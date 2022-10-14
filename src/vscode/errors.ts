import * as vscode from "vscode"
import { OptionalPromiseLike } from "../core/types"

export function handleError (error: unknown, errorMessage?: string) {
  if (error instanceof PintOSExtensionError) {
    vscode.window.showErrorMessage(error.message)
  } else if (error instanceof PintOSExtensionCancellationError) {
    vscode.window.showErrorMessage(error.message || "Canceled Action")
  } else if (error instanceof Error) {
    const thenable = vscode.window.showErrorMessage(errorMessage ?? error.message, "show stacktrace")
    thenable.then((value) => {
      if (value === "show stacktrace") {
        vscode.window.showErrorMessage(`[${error.message}] ${error.stack ?? ""}`)
      }
    })
  } else {
    vscode.window.showErrorMessage(`${error ?? "unknown error"}`)
  }
}

export async function executeOrStopOnError<T>({ execute, message, onError }: { execute: () => OptionalPromiseLike<T>, message?: string, onError?: (e: unknown) => void }) {
  try {
    return await execute()
  } catch (e) {
    onError?.(e)
    throw new PintOSExtensionCancellationError(message)
  }
}

export class PintOSExtensionError extends Error {}

export class PintOSExtensionCancellationError extends Error {}
