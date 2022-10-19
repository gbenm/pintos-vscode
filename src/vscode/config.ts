import * as vscode from "vscode"

export class Config {
  static get baseRepository (): string {
    const repo = this.config.get<string>("baseRepository")

    return this.required({
      value: repo,
      errorMessage: "You need to add a base repository to get a snapshot of PintOS"
    })
  }

  static get baseRepositoryCodeFolder (): string | null {
    const codeFolder = this.config.get<string>("baseRepositoryCodeFolder")
    return codeFolder ?? null
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

  private static get config () {
    return vscode.workspace.getConfiguration("pintos")
  }

  private static required<T>({
    value,
    errorMessage
  }: { value: T | undefined, errorMessage: string }): T {
    if (!value) {
      throw new Error(errorMessage)
    }

    return value
  }
}

