import { writeFileSync } from "fs"
import { dirname, basename } from "path"
import { genDiscoverMakefileContent, TestDirLocator, TestIdGen, TestIdSplitter } from "./lookup"

export const getDirOfTest: TestDirLocator = (testId) => `build/${dirname(testId)}`

export const getNameOfTest: (testId: string) => string = basename

export const generateTestId: TestIdGen = ({ baseId, segment }) => {
  if (baseId) {
    return `${baseId}/${segment}`
  }

  return segment
}

export const splitTestId: TestIdSplitter = (testId) => testId.split("/")

export function onMissingDiscoverMakefile (discoverMakefileName: string) {
  writeFileSync(discoverMakefileName, genDiscoverMakefileContent())
}
