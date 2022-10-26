import * as vscode from "vscode"

export class Config {
  static get baseRepository (): string {
    const repo = this.config.get<string>("baseRepository")

    return this.required({
      value: repo,
      key: "baseRepository",
      errorMessage: "You need to add a base repository to get a snapshot of PintOS"
    })
  }

  static get baseRepositoryCodeFolder (): string {
    const codeFolder = this.config.get<string>("baseRepositoryCodeFolder")
    return this.required({
      value: codeFolder,
      key: "baseRepositoryCodeFolder",
      errorMessage: "You need to specify source code folder of the pintos"
    })
  }

  static get personalRepoUrl (): string | null {
    const personalRepoUrl = this.config.get<string>("personalRepoUrl")
    return personalRepoUrl ?? null
  }

  static get pintosPhases (): string[] {
    return this.required({
      value: this.config.get<string[]>("phases"),
      key: "phases",
      errorMessage: "You must add phases to use this extension"
    })
  }

  static get addPintosUtilsToPath (): boolean {
    return this.required({
      key: "addUtilsToPath",
      value: this.config.get<boolean>("addUtilsToPath"),
    })
  }

  static get buildPintosUtils (): boolean {
    return this.required({
      key: "buildUtils",
      value: this.config.get<boolean>("buildUtils"),
    })
  }

  static get useNodejsNativeKill (): boolean {
    return this.required({
      key: "useNodejsNativeKill",
      value: this.config.get<boolean>("useNodejsNativeKill"),
    })
  }

  private static get config () {
    return vscode.workspace.getConfiguration("pintos")
  }

  private static required<T>({
    value,
    key,
    errorMessage = `${key} is Required`
  }: { value: T | undefined, errorMessage?: string, key: string }): T {
    if (typeof value === "undefined") {
      throw new Error(errorMessage)
    }

    return value
  }
}

