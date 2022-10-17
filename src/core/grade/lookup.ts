import { Dirent, existsSync, readFileSync } from "fs"
import { join as joinPath } from "path"
import { tests } from "vscode"
import { scopedCommand, executeCommand } from "../launch"
import { OptionalPromiseLike } from "../types"
import { runInnerTests, runPintosPhase, runSpecificTest, setStatusFromResultFile } from "./run"
import { TestItem, TestRunner } from "./TestItem"

const discoverMakefile = "vscTestDiscover.Makefile"

export function ensureLookupTestsInPhase({ onMissingLocation, onMissingDiscoverMakefile, splitId, generateId, getNameOf, getDirOf }: {
  onMissingLocation: (location: LookupLocation) => OptionalPromiseLike<void>
  onMissingDiscoverMakefile: (discoverMakefileName: string, location: LookupLocation) => OptionalPromiseLike<void>
  getDirOf: TestDirLocator
  getNameOf: (id: string) => string
  splitId: TestIdSplitter
  generateId: TestIdGen
}, location: LookupLocation): Promise<TestItem> {
  const { path, phase } = location

  return scopedCommand({
    cwd: phase,
    async execute() {
      if (!existsSync(path)) {
        await onMissingLocation(location)
      }

      const discoverMakefilePath = joinPath(path, discoverMakefile)
      if (!existsSync(discoverMakefilePath)) {
        await onMissingDiscoverMakefile(discoverMakefilePath, location)
      }

      const testsIds = getTestsFromMakefile(discoverMakefile, path)

      const testTree = generateTestTree({
        ids: testsIds,
        generateId,
        splitId,
        phase
      })

      const [mainTestId, ...rest] = Object.keys(testTree)

      if (rest.length > 0) {
        throw new Error(`The "${phase}" phase must have only one main test`)
      }

      const tree = testTree[mainTestId]

      return testItemFactory({
        tree,
        getDirOf: getDirOf,
        getNameOf,
        phase,
        testId: mainTestId,
        parentTestRun: runPintosPhase
      })
    },
  })
}

export function testItemFactory({ tree, testId, phase, getDirOf, getNameOf, parentTestRun, elseChildren }: {
  tree: TestTree | null
  phase: string
  testId: string
  getDirOf: TestDirLocator
  getNameOf: (id: string) => string
  parentTestRun?: TestRunner
  elseChildren?: TestItem[]
}): TestItem {
  if (tree === null) {
    const test = new TestItem({
      id: testId,
      basePath: getDirOf(testId),
      name: getNameOf(testId),
      phase,
      children: elseChildren || [],
      run: parentTestRun || runSpecificTest
    })

    if (!test.isComposite) {
      setStatusFromResultFile(test)
    }

    return test
  }

  const children = Object.keys(tree).map(id => testItemFactory({
    testId: id,
    getDirOf: getDirOf,
    getNameOf,
    phase,
    tree: tree[id],
  }))

  if (children.length === 0) {
    throw new Error("has not element but isn't a terminal test")
  }

  return testItemFactory({
    tree: null,
    getDirOf,
    getNameOf,
    phase,
    testId,
    elseChildren: children,
    parentTestRun: parentTestRun || runInnerTests
  })
}

export function generateTestTree({ ids, generateId, splitId, phase }: {
  ids: string[]
  phase: string
  generateId: TestIdGen
  splitId: TestIdSplitter
}): TestTree {
  const tree: TestTree = {}

  ids.map((id) => {
    const testWithParents = <string[]> splitId(id).map(
      (_, i, segments: Array<string | null>) => segments.slice(0, i + 1)
        .reduce(
          (baseId, segment) => generateId({ baseId, segment: segment!, phase }),
          null,
        )
    )

    return {
      parents: testWithParents.slice(0, testWithParents.length - 1),
      test: testWithParents.slice(-1)[0]
    }
  }).forEach(({ test, parents }) => {
    let subtree: TestTree = {}
    const [firstParent, ...rest] = parents

    if (tree[firstParent]) {
      subtree = <TestTree> tree[firstParent]
    } else {
      tree[firstParent] = subtree
    }

    rest.forEach((parent) => {
      if (!subtree[parent]) {
        subtree[parent] = {}
      }

      subtree = <TestTree> subtree[parent]
    })

    subtree[test] = null
  })

  return tree
}

export function getTestsFromMakefile(makefile: string, cwd?: string) {
  const result = executeCommand({
    cwd,
    cmd: `make -f ${makefile} pintos-vscode-discover`
  }).toString()

  let inScope = false
  const testids = result.split("\n").filter((chunk) => {
    let keepLine = inScope
    const line = chunk.trim()
    if (line === "BEGIN_TESTS") {
      inScope = true
    } else if (line === "END_TESTS") {
      inScope = false
      keepLine = false
    }

    return keepLine
  }).flatMap(line => line.split(/\s+/))

  return testids
}

export const genDiscoverMakefileContent = ({ parentMakefile = "./Makefile", extraTests = "" }: {
  parentMakefile?: string
  extraTests?: string
} = {}) => `include ${parentMakefile}

${"SUFFIXES = %_TESTS %_EXTRA_GRADES".concat(extraTests).trim()}

pintos-vscode-discover:
    $(info BEGIN_TESTS)
    $(foreach v,\\
        $(filter $(SUFFIXES), $(.VARIABLES)),\\
        $(info $($(v)))\\
    )
    $(info END_TESTS)
`

export interface LookupLocation {
  phase: string
  path: string
}

export interface TestTree {
  [parentId: string]: TestTree | null
}

export type TestIdGen = (args: { phase: string, baseId: string | null, segment: string }) => string

export type IsTestChecker = (dirent: Dirent) => boolean

export type TestIdSplitter = (testId: string) => Array<string>

export type TestDirLocator = (testId: string) => string
