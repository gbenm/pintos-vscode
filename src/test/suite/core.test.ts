/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from "assert"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { ensureLookupTestsInPhase, getTestsFromMakefile, genDiscoverMakefileContent, generateTestTree, TestTree } from "../../core/grade/lookup"
import { TestItem, TestStatus } from "../../core/grade/TestItem"
import { generateTestId, getDirOfTest, getNameOfTest, onMissingDiscoverMakefile, splitTestId } from "../../core/grade/utils"
import { scopedCommand } from "../../core/launch"
import { prop } from "../../core/utils/fp/common"

const run = () => <TestStatus> "passed"
const dataBuilder = () => null

suite("Test Items", () => {
  test("get all tests ids", () => {
    const mainTest = fakeTestItemFactory({
      id: "tests/threads",
      children: [
        fakeTestItemFactory({
          id: "tests/threads/test1"
        }),
        fakeTestItemFactory({
          id: "tests/threads/nested",
          children: [
            fakeTestItemFactory({
              id: "tests/threads/nested/test1",
            }),
            fakeTestItemFactory({
              id: "tests/threads/nested/test2"
            }),
          ],
        }),
        fakeTestItemFactory({
          id: "tests/threads/test2"
        })
      ],
    })

    assert.deepEqual(
      Array.from(mainTest, prop("id")),
      [
        "tests/threads",
        "tests/threads/test1",
        "tests/threads/nested",
        "tests/threads/nested/test1",
        "tests/threads/nested/test2",
        "tests/threads/test2"
      ]
    )
  })

  test("get tests ids from Makefile", () => {
    scopedCommand({
      cwd: ".testWorkspace",
      tempDir: true,
      execute () {
        createTestTree({
          Makefile: [
            {
              variable: "PRUEBA_TESTS",
              tests: [
                "tests/threads/test1",
                "tests/threads/test2",
                "tests/userprog/test1"
              ]
            },
            {
              variable: "PRUEBA_EXTRA_GRADES",
              tests: [
                "tests/userprog/test1-extra",
                "tests/userprog/test2-extra",
                "tests/threads/test1-extra"
              ]
            }
          ]
        })

        writeFileSync("test.Makefile", genDiscoverMakefileContent())

        const ids = getTestsFromMakefile("test.Makefile")

        assert.deepEqual(
          ids.sort(),
          [
            "tests/threads/test1",
            "tests/threads/test2",
            "tests/userprog/test1",
            "tests/userprog/test1-extra",
            "tests/userprog/test2-extra",
            "tests/threads/test1-extra"
          ].sort()
        )
      }
    })
  })

  test("generate test tree from ids", () => {
    const ids = [
      "tests/threads/test1",
      "tests/threads/test2",
      "tests/userprog/test1",
      "tests/userprog/test2",
      "tests/userprog/base/test1",
      "tests/userprog/base/test2"
    ]

    const tree = generateTestTree({
      ids,
      generateId: generateTestId,
      phase: "fake",
      splitId: splitTestId
    })

    assert.deepStrictEqual(tree, {
      tests: {
        "tests/threads": {
          "tests/threads/test1": null,
          "tests/threads/test2": null
        },
        "tests/userprog": {
          "tests/userprog/test1": null,
          "tests/userprog/test2": null,
          "tests/userprog/base": {
            "tests/userprog/base/test1": null,
            "tests/userprog/base/test2": null
          }
        }
      }
    })
  })

  test("discover tests", async () => {
    await scopedCommand({
      cwd: ".testWorkspace",
      tempDir: true,
      async execute () {
        createTestTree({
          "threads/build": {
            Makefile: [
              {
                variable: "PRUEBA_TESTS",
                tests: [
                  "tests/threads/test1",
                  "tests/threads/test2",
                  "tests/threads/test3"
                ]
              }
            ]
          },
          "userprog/build": {
            Makefile: [
              {
                variable: "PRUEBA_TESTS",
                tests: [
                  "tests/threads/test1",
                  "tests/threads/test2",
                  "tests/userprog/test1"
                ]
              },
              {
                variable: "PRUBA_EXTRA_GRADES",
                tests: [
                  "tests/userprog/test1-extra",
                  "tests/userprog/test2-extra",
                  "tests/threads/test1-extra"
                ]
              }
            ]
          }
        })

        const path = "build"

        const getTestsFrom = (phase: string) => ensureLookupTestsInPhase({
          onMissingLocation({ path }) {
            throw new Error(`[Dev] ${path} is missing`)
          },
          generateId: generateTestId,
          getDirOf: getDirOfTest,
          getNameOf: getNameOfTest,
          splitId: splitTestId,
          testDataBuilder: dataBuilder,
          onMissingDiscoverMakefile
        }, { path, phase })

        const threadsTest = await getTestsFrom("threads")

        const toTestTree = TestItem.createMapper<TestTree>((item, fn) => {
          if (item.isComposite) {
            return {
              [item.id]: item.children.map(item => item.map(fn))
                .reduce((acc, entry: TestTree) => {
                  return { ...acc, ...entry }
                })
            }
          }

          return { [item.id]: null }
        })

        const threadsTestTree = threadsTest.map(toTestTree)

        assert.deepStrictEqual(threadsTestTree, {
          tests: {
            "tests/threads": {
              "tests/threads/test1": null,
              "tests/threads/test2": null,
              "tests/threads/test3": null
            }
          }
        })

        const userprogTest = await getTestsFrom("userprog")

        const userprogTestTree = userprogTest.map(toTestTree)

        assert.deepEqual(
          userprogTestTree,
          {
            tests: {
              "tests/threads": {
                "tests/threads/test1": null,
                "tests/threads/test2": null,
                "tests/threads/test1-extra": null,
              },
              "tests/userprog": {
                "tests/userprog/test1": null,
                "tests/userprog/test1-extra": null,
                "tests/userprog/test2-extra": null
              },
            }
          }
        )
      },
    })
  })

  suite("subscribe to test status", () => {
    test("listen status changes", () => {
      const statusHistory: string[] = []

      const testItem3 = fakeTestItemFactory({
        id: "3",
        children: []
      })
      const testItem4 = fakeTestItemFactory({
        id: "4",
        children: []
      })
      const mainTest = fakeTestItemFactory({
        id: "1",
        children: [
          fakeTestItemFactory({
            id: "2",
            children: [testItem3]
          }),
          testItem4
        ]
      })

      mainTest.on("status", test => statusHistory.push(test.id))

      testItem3.status = "passed"
      testItem4.status = "passed"

      assert.deepEqual(statusHistory, ["3", "2", "4", "1"])
    })

    test("merge status", () => {
      const statusHistory: Array<{ status: TestStatus, id: string }> = []
      const test3 = fakeTestItemFactory({ id: "3", })
      const test4 = fakeTestItemFactory({ id: "4" })
      const test5 = fakeTestItemFactory({ id: "5" })
      const mainTest = fakeTestItemFactory({
        id: "1",
        children: [
          fakeTestItemFactory({
            id: "2",
            children: [test3, test4]
          }),
          test5
        ]
      })

      mainTest.on("status", ({ id, status }) => statusHistory.push({ id, status }))

      test3.status = "enqueued"
      test4.status = "enqueued"
      test5.status = "enqueued"

      test3.status = "started"
      test3.status = "passed"

      test4.status = "started"
      test4.status = "failed"

      test5.status = "started"
      test5.status = "errored"

      const expectedHistory: typeof statusHistory = [
        { id: "3", status: "enqueued" },
        { id: "2", status: "enqueued" },
        { id: "1", status: "enqueued" },
        { id: "4", status: "enqueued" },
        { id: "5", status: "enqueued" },

        { id: "3", status: "started" },
        { id: "2", status: "started" },
        { id: "1", status: "started" },
        { id: "3", status: "passed" },
        { id: "2", status: "enqueued" },
        { id: "1", status: "enqueued" },

        { id: "4", status: "started" },
        { id: "2", status: "started" },
        { id: "1", status: "started" },
        { id: "4", status: "failed" },
        { id: "2", status: "failed" },
        { id: "1", status: "enqueued" },

        { id: "5", status: "started" },
        { id: "1", status: "started" },
        { id: "5", status: "errored" },
        { id: "1", status: "failed" },
      ]

      assert.deepEqual(statusHistory, expectedHistory)
    })
  })
})


function createTestTree (testTree: Partial<TestTreeDescriptor>) {
  const folders =  Object.keys(testTree).filter(entry => !Array.isArray(testTree[entry]))
  const makefiles = Object.keys(testTree).filter(entry => Array.isArray(testTree[entry]))

  makefiles.forEach((file) => {
    writeFileSync(file, createMakefileWithTests(<TestVarTreeEntry[]> testTree[file]))
  })

  folders.forEach((folder) => {
    if (!existsSync(folder)) {
      mkdirSync(folder, { recursive: true })
    }

    scopedCommand({
      cwd: folder,
      execute: () => createTestTree(<TestTreeDescriptor> testTree[folder])
    })
  })
}

function createMakefileWithTests(vars: TestVarTreeEntry[]): string {
  return vars.map(entry => `${entry.variable} = ${entry.tests.join(" ")}`).join("\n").concat("\n")
}

type TestTreeDescriptor = {
  [entry: string]: TestTreeDescriptor | TestVarTreeEntry[]
}

interface TestVarTreeEntry {
  variable: string
  tests: string[]
}

function fakeTestItemFactory ({ id, children = [] }: { id: string, children?: TestItem[] }): TestItem {
  return new TestItem({
    id,
    children: children,
    name: "1",
    basePath: "fake/path",
    phase: "fake",
    run,
    dataBuilder,
    makefileTarget: "fake",
    resultFile: "fake.result"
  })
}
