import * as vscode from "vscode"
import { OptionalPromiseLike } from "../core/types"

export function handleError (error: unknown, errorMessage?: string) {
  if (error instanceof PintOSExtensionError) {
    showMessageOfExtError({
      message: error.message,
      severity: error.severity
    })
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

export function showMessageOfExtError ({ message, severity }: { message: string, severity: ErrorSeverity }) {
  switch (severity) {
    case "error":
      vscode.window.showErrorMessage(message)
      break
    case "warning":
      vscode.window.showWarningMessage(message)
      break
    case "info":
      vscode.window.showWarningMessage(message)
      break
    default:
      throw new Error("[Error Handler] Unknown severity message")
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

export class PintOSExtensionError extends Error {
  constructor (message: string, public readonly severity: ErrorSeverity = "error") {
    super(message)
  }
}

export type ErrorSeverity = "error" | "warning" | "info"

export class PintOSExtensionCancellationError extends PintOSExtensionError {
  constructor (message: string = "Canceled Action", severity: ErrorSeverity = "warning") {
    super(message, severity)
  }
}
