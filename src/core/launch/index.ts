import { execSync, spawn } from "node:child_process"
import { ensureSingleValue } from "../utils/fp/arrays"
import { OptionalPromiseLike, OutputChannel } from "../types"
import { buildSingleCommand } from "./utils"
import { existsSync, mkdir, mkdirSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import { removeSync } from "fs-extra"

export function executeCommand({ output, cmd, cwd = process.cwd() }: {
  output?: OutputChannel
  cmd: string | string[]
  cwd?: string
}): Buffer {
  const cmdMessage = cmdToDisplay(cmd)
  output?.appendLine("[start]")
  output?.appendLine(cmdMessage)

  const cwdBackup = process.cwd()
  try {
    process.chdir(cwd)
    const targetCmd = ensureSingleValue(buildSingleCommand, cmd)
    const result = execSync(targetCmd)

    output?.appendLine("[complete]")
    output?.appendLine(cmdMessage)

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

export async function scopedCommand<T>({ cwd, execute, tempDir = false }: {
  execute: () => OptionalPromiseLike<T>,
  cwd: string
  tempDir?: boolean
}): Promise<T> {
  const cwdBackup = process.cwd()
  const dir = resolvePath(cwd)
  try {
    if (tempDir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    process.chdir(dir)
    return await execute()
  } catch (e) {
    throw e
  } finally {
    process.chdir(cwdBackup)
    removeSync(dir)
  }
}

export function spawnCommand({ cmd, args, cwd }: {
  cmd: string
  args: string[]
  cwd?: string
}) {
  const child = spawn(cmd, args, {
    cwd,
    shell: false,
    stdio: "pipe"
  })
  return child
}
