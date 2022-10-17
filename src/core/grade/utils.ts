import { writeFileSync } from "fs"
import { dirname, basename } from "path"
import { genDiscoverMakefileContent, TestDirLocator, TestIdGen, TestIdSplitter } from "./lookup"

export const getDirOfTest: TestDirLocator = dirname

export const getNameOfTest: (testId: string) => string = basename

export const generateTestId: TestIdGen = ({ baseId, segment }) => {
  if (baseId) {
    return `${baseId}/${segment}`
  }

  return segment
}

export const splitTestId: TestIdSplitter = (testId) => testId.split("/")

export function onMissingDiscoverMakefile (discoverMakefileName: string) {
  console.log(`Write makefile ${discoverMakefileName} in ${process.cwd()}`)
  writeFileSync(discoverMakefileName, genDiscoverMakefileContent())
}
