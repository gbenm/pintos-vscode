import { ChildProcessWithoutNullStreams, execSync, spawn } from "node:child_process"
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
    if (tempDir) {
      removeSync(dir)
    }
  }
}

export function spawnCommand({ cmd, args, cwd, env = {} }: {
  cmd: string
  args: string[]
  cwd?: string,
  env?: NodeJS.ProcessEnv
}) {
  const child = spawn(cmd, args, {
    cwd,
    shell: false,
    stdio: "pipe",
    env: {
      ...process.env,
      ...env
    }
  })
  return child
}

export function childProcessToPromise({ process }: {
  process: ChildProcessWithoutNullStreams
}): Promise<Buffer>
export function childProcessToPromise({ process, onData }: {
  process: ChildProcessWithoutNullStreams
  onData: (data: Buffer) => void
}): Promise<void>
export function childProcessToPromise({ process, onData }: {
  process: ChildProcessWithoutNullStreams,
  onData?: (data: Buffer) => void
}): Promise<void | Buffer> {
  return new Promise((resolve, reject) => {
    if (onData) {
      process.stdout.on("data", onData)
      process.stderr.on("data", onData)
      process.on("exit", resolve)
    } else {
      const result: Buffer[] = []
      process.stdout.on("data", (data: Buffer) => {
        result.push(data)
      })
      process.on("exit", () => resolve(Buffer.concat(result)))
    }
    process.on("error", reject)
  })
}
