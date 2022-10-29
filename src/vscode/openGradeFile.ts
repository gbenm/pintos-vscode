import * as vscode from "vscode"

export default async (uri: vscode.Uri) => {
  const document = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Two)
}
