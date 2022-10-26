import { ChildProcess, ChildProcessWithoutNullStreams, execSync, spawn } from "node:child_process"
import { ensureSingleValue } from "../utils/fp/arrays"
import { OptionalPromise, OptionalPromiseLike, OutputChannel } from "../types"
import { buildSingleCommand } from "./utils"
import { existsSync, mkdir, mkdirSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import { removeSync } from "fs-extra"
import { isPromise } from "node:util/types"
import { conditionalExecute } from "../utils"

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

export function scopedCommand<R>({ cwd, execute, tempDir = false }: {
  execute: ScopedCommandExecutor<R>,
  cwd: string
  tempDir?: boolean
}): R  {
  const cwdBackup = process.cwd()
  const dir = resolvePath(cwd)

  const restore = () => {
    process.chdir(cwdBackup)
    if (tempDir) {
      removeSync(dir)
    }
  }

  let skipRestoreSync = false

  try {
    if (tempDir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    process.chdir(dir)

    const result = execute({
      chdir: process.chdir.bind(process),
      resetCwd: () => process.chdir(dir)
    })

    if (isPromise(result)) {
      skipRestoreSync = true
      return <any> result.finally(restore)
    } else if (typeof (<any> result)?.["then"] === "function") {
      throw new Error("PromiseLike is not supported. Only Promise is supported")
    }

    return result
  } catch (e) {
    throw e
  } finally {
    conditionalExecute({
      condition: !skipRestoreSync,
      execute: restore
    })
  }
}

export type ScopedCommandExecutor<R> = ({ chdir }: {
    chdir: (dir: string) => void
    resetCwd: () => void
  }) => R

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
    },
    detached: true,
  })

  child.unref()

  return child
}

export function childProcessToPromise(process: ChildProcessWithoutNullStreams): Promise<Buffer>
export function childProcessToPromise({ process }: {
  process: ChildProcessWithoutNullStreams
}): Promise<Buffer>
export function childProcessToPromise({ process, onData }: {
  process: ChildProcessWithoutNullStreams
  onData: (data: Buffer) => void
}): Promise<void>
export function childProcessToPromise(args: {
  process: ChildProcessWithoutNullStreams,
  onData?: (data: Buffer) => void
} | ChildProcessWithoutNullStreams): Promise<void | Buffer> {
  let process: ChildProcessWithoutNullStreams
  let onData: ((data: Buffer) => void) | undefined
  if (args instanceof ChildProcess) {
    process = <ChildProcessWithoutNullStreams> args
    onData = undefined
  } else {
    process = args.process
    onData = args.onData
  }
  return new Promise((resolve, reject) => {
    if (onData) {
      process.stdout.on("data", onData)
      process.stderr.on("data", onData)
      process.on("close", resolve)
    } else {
      const result: Buffer[] = []
      process.stdout.on("data", (data: Buffer) => {
        result.push(data)
      })
      process.on("close", () => resolve(Buffer.concat(result)))
    }
    process.on("error", reject)
  })
}
