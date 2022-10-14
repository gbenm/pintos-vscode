import { execSync } from "node:child_process"
import { ensureSingleValue } from "../utils/fp/arrays"
import { OutputChannel } from "../types"
import { buildSingleCommand } from "./utils"

export function executeCommand({ output, cmd, cwd = process.cwd() }: {
  output: OutputChannel
  cmd: string | string[]
  cwd?: string
}): Buffer {
  const cmdMessage = cmdToDisplay(cmd)
  output.appendLine("[start]")
  output.appendLine(cmdMessage)

  const cwdBackup = process.cwd()
  try {
    process.chdir(cwd)
    const targetCmd = ensureSingleValue(buildSingleCommand, cmd)
    const result = execSync(targetCmd)

    output.appendLine("[complete]")
    output.appendLine(cmdMessage)

    return result
  } catch (e) {
    throw e
  } finally {
    process.chdir(cwdBackup)
  }
}

function cmdToDisplay(cmd: string | string[]) {
  if (Array.isArray(cmd)) {
    return cmd.reduce((acc, cmd) => acc.concat(`\t${cmd}\n`), "")
  }
  return `\t${cmd}\n`
}
