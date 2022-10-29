import { ChildProcess, ChildProcessWithoutNullStreams, execSync, spawn } from "node:child_process"
import { ensureSingleValue } from "../utils/fp/arrays"
import { OutputChannel } from "../types"
import { buildSingleCommand } from "./utils"
import { existsSync, mkdirSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import { removeSync } from "fs-extra"
import { isPromise } from "node:util/types"
import { conditionalExecute } from "../utils"
import { SpawnOptions } from "./types"

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

export function spawnCommand({ cmd, args, cwd, env = {} }: SpawnOptions) {
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

export function childProcessToPromise(process: ChildProcessWithoutNullStreams): Promise<Buffer>
export function childProcessToPromise(
  { process }: {
    process: ChildProcessWithoutNullStreams
  }
): Promise<Buffer>
export function childProcessToPromise(
  { process, onData }: {
    process: ChildProcessWithoutNullStreams
    onData: (data: Buffer) => void
    abort?: AbortSignal
  }
): Promise<void>
export function childProcessToPromise(
  args: {
    process: ChildProcessWithoutNullStreams,
    onData?: (data: Buffer) => void
    abort?: AbortSignal
  } | ChildProcessWithoutNullStreams
): Promise<void | Buffer> {

  let process: ChildProcessWithoutNullStreams
  let onData: ((data: Buffer) => void) | undefined
  let abort: AbortSignal | undefined
  if (args instanceof ChildProcess) {
    process = <ChildProcessWithoutNullStreams> args
    onData = undefined
  } else {
    process = args.process
    onData = args.onData
    abort = args.abort
  }

  return new Promise((resolve, reject) => {
    const resolver = { resolve }

    if (onData) {
      process.stdout.on("data", onData)
      process.stderr.on("data", onData)
    } else {
      const result: Buffer[] = []
      const concatToBuffer = (data: Buffer) => {
        result.push(data)
      }

      process.stdout.on("data", concatToBuffer)
      process.stderr.on("data", concatToBuffer)
      resolver.resolve = () => resolve(Buffer.concat(result))
    }


    const killProcess = () => {
      const request = abort?.reason!
      if (request instanceof SpawnAbortRequest) {
        reject(request.error)
        process.kill(request.signal)
      } else {
        reject(request)
        process.kill()
      }
    }

    abort?.addEventListener("abort", killProcess)

    const dispose = (fn: (...args: any[]) => void) => (...args: any[]) => {
      process.stdout.removeAllListeners()
      process.stderr.removeAllListeners()
      abort?.removeEventListener("abort", killProcess)
      fn(...args)
    }

    process.on("close", dispose(resolver.resolve))
    process.on("error", dispose(reject))
  })
}

export class SpawnAbortRequest {
  constructor (
    public readonly signal?: NodeJS.Signals,
    public readonly error?: Error
  ) {}

  static of ({ signal, error }: Pick<SpawnAbortRequest, "error" | "signal"> = {}) {
    return new SpawnAbortRequest(signal, error)
  }
}
