import * as vscode from "vscode"

export class Config {
  static get baseRepository (): string {
    const repo = this.config.get<string>("baseRepository")

    return this.required({
      value: repo,
      errorMessage: "You need to add a base repository to get a snapshot of PintOS"
    })
  }

  static get baseRepositoryCodeFolder (): string {
    const codeFolder = this.config.get<string>("baseRepositoryCodeFolder")
    return this.required({
      value: codeFolder,
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
      errorMessage: "You must add phases to use this extension"
    })
  }

  static get addPintosUtilsToPath (): boolean {
    return this.required({
      value: this.config.get<boolean>("addUtilsToPath"),
    })
  }

  private static get config () {
    return vscode.workspace.getConfiguration("pintos")
  }

  private static required<T>({
    value,
    errorMessage = "Required"
  }: { value: T | undefined, errorMessage?: string }): T {
    if (!value) {
      throw new Error(errorMessage)
    }

    return value
  }
}

