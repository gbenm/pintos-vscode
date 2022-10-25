import { readFileSync, writeFileSync } from "fs"
import { join as joinPath } from "path"
import simpleGit from "simple-git"

const mark = "# gbenm@pintos"

export function setupPintosDebugger () {
  const targetFile = joinPath("utils", "pintos-gdb")
  const content = readFileSync(targetFile).toString()

  if (content.match(new RegExp(mark, "g"))) {
    return
  }

  const lines = content.split("\n")
  lines.splice(1, 0, "\n# The comment below is used to know if the extension modified this file", mark)

  const infoComment = "# PintOS VSCode: Don't change this value"

  const newContent = lines.flatMap(line => {
    const matches = line.match(/GDBMACROS.*=(.*)/)
    if (matches) {
      return [
        `GDBMACROS_DEFAULT=${matches[1]}\n`,
        infoComment,
        "GDBMACROS=${GDBMACROS:-$GDBMACROS_DEFAULT}",
        infoComment
      ]
    }

    return [line]
  }).join("\n")

  writeFileSync(targetFile, newContent)

  const git = simpleGit()
  git.add(targetFile).commit("chore(pintos-vscode): setup gdb macros")
}
