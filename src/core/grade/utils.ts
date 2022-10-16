import { extname } from "path"
import { IsTestChecker, TestIdGen } from "./lookup"

export const isTest: IsTestChecker = dirent => {
  if (dirent.isFile() && extname(dirent.name) === ".o") {
    return true
  }

  return dirent.isDirectory()
}

export const isRootTest: IsTestChecker = dirent => dirent.isDirectory()

export const generateTestId: TestIdGen = ({ baseId, segment }) => {
  if (baseId) {
    return `${baseId}/${segment}`
  }

  return segment
}
