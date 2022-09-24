/**
 * The implementation must work as vscode.OutputChannel
 */
export interface OutputChannel {
  append (value: string): void
  appendLine (value: string): void
  clear (): void
  replace (value: string): void
}
