import { scopedCommand, spawnCommand } from "."
import { KernelScheduler, PintosSimulator, SpawnOptions, SpawnRequestOptions } from "./types"
import * as kill from "tree-kill"
import { ChildProcessWithoutNullStreams } from "child_process"

export class SpawnRequest {
  protected readonly nativeKill: boolean
  protected readonly cmd: string
  protected readonly args: readonly string[]
  protected readonly cwd: string | undefined
  protected readonly env: Readonly<NodeJS.ProcessEnv> | undefined
  protected readonly factory = SpawnRequest.create

  protected constructor (options: SpawnRequestOptions) {
    this.nativeKill = options.nativeKill
    this.cmd = options.cmd
    this.args = options.args
    this.cwd = options.cwd
    this.env = options.env
  }

  public otherArgs (args: string[]) {
    return this.cloneWith({
      args
    })
  }

  public spawn (): ChildProcessWithoutNullStreams {
    const child = spawnCommand({
      cwd: this.cwd,
      cmd: this.cmd,
      args: this.args,
      env: this.env
    })

    if (!this.nativeKill) {
      child.kill = (signal: NodeJS.Signals) => {
        if (child.pid) {
          kill(child.pid, signal)
          return true
        } else {
          throw new Error("[DEV] child doesn't has pid")
        }
      }
    }

    return child
  }

  protected cloneWith (options: Pick<SpawnRequestOptions, "args">) {
    return this.factory({
      nativeKill: this.nativeKill,
      cwd: this.cwd,
      env: this.env,
      cmd: this.cmd,
      args: this.args.concat(options.args),
    })
  }

  protected options (): SpawnRequestOptions {
    return {
      args: this.args,
      cmd: this.cmd,
      nativeKill: this.nativeKill,
      cwd: this.cwd,
      env: this.env
    }
  }

  public static create (options: SpawnRequestOptions) {
    return new SpawnRequest(options)
  }
}

export class PintosSpawnRequest extends SpawnRequest {
  protected factory = PintosSpawnRequest.create

  public noVGA () {
    return this.cloneWith({
      args: ["-v"]
    })
  }

  public debug () {
    return this.cloneWith({
      args: ["--gdb"]
    })
  }

  public simulator (simulator: PintosSimulator) {
    return this.cloneWith({
      args: [`--${simulator}`]
    })
  }

  public kernel () {
    return PintosSpawnRequestWithKernel.createFrom(this)
  }

  protected cloneWith (options: Pick<SpawnRequestOptions, "args">): PintosSpawnRequest {
    return <PintosSpawnRequest> super.cloneWith(options)
  }

  public static create (options: Omit<SpawnRequestOptions, "cmd">) {
    return new PintosSpawnRequest({
      cmd: "pintos",
      ...options
    })
  }
}

class PintosSpawnRequestWithKernel extends SpawnRequest {
  protected factory = PintosSpawnRequestWithKernel.createFromScratch

  public run (test: string) {
    return super.cloneWith({
      args: ["run", test]
    })
  }

  public scheduler (scheduler: KernelScheduler) {
    const args: string[] = []

    if (scheduler === "mlfqs") {
      args.push("-mlfqs")
    }

    return this.cloneWith({
      args
    })
  }

  public autoPowerOff () {
    return this.cloneWith({
      args: ["-q"]
    })
  }

  protected cloneWith (options: Pick<SpawnRequestOptions, "args">): PintosSpawnRequestWithKernel {
    return <PintosSpawnRequestWithKernel> super.cloneWith(options)
  }

  private static createFromScratch (options: SpawnRequestOptions) {
    return new PintosSpawnRequestWithKernel(options)
  }

  public static createFrom (request: PintosSpawnRequest) {
    const options = request["options"]()
    return PintosSpawnRequestWithKernel.createFromScratch({
      ...options,
      args: options.args.concat("--")
    })
  }

  public static create (): SpawnRequest {
    throw new Error("can't use create static method")
  }
}

export default class PintosShell {
  private constructor (
    private readonly nativeKill: boolean
  ) {

  }

  public pintos (options: Omit<SpawnOptions, "cmd" | "args"> = {}) {
    return PintosSpawnRequest.create({
      nativeKill: this.nativeKill,
      args: [],
      ...options
    })
  }

  public make (options: Omit<SpawnOptions, "cmd">): ChildProcessWithoutNullStreams {
    return this.spawn({
      cmd: "make",
      ...options
    })
  }

  public spawn (options: SpawnOptions): ChildProcessWithoutNullStreams {
    return SpawnRequest.create({
      nativeKill: this.nativeKill,
      ...options
    }).spawn()
  }

  public static create ({ nativeKill = false }: {
    /** when the value is false, tree-kill lib is used to kill the process */
    nativeKill?: boolean
  } = {}) {
    return new PintosShell(
      nativeKill
    )
  }
}
