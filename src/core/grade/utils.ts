import { writeFileSync } from "fs"
import { dirname, basename } from "path"
import { OutputChannel } from "vscode"
import { childProcessToPromise } from "../launch"
import { compilePhase } from "./compile"
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

export async function onMissingTestDir ({ phase, output }: { phase?: string, output?: OutputChannel } = {}) {
  await childProcessToPromise({
    process: compilePhase(phase),
    onData (buffer: Buffer) {
      output?.append(buffer.toString())
    }
  })
}
