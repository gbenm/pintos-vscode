import * as colors from "ansi-colors"
import { TestStatus } from "../grade/TestItem"

const themeForStatusTests: colors.CustomTheme<TestStatus> = {
  enqueued: colors.gray,
  skipped: colors.yellow,
  errored: colors.red.bold,
  failed: colors.red,
  passed: colors.green,
  started: colors.gray,
  unknown: colors.gray
}

declare module "ansi-colors" {
  type CustomTheme<Keys extends string = string> = {
    [name in Keys]: StyleFunction
  }

  function theme (custom: CustomTheme): void;

  const enqueued: StyleFunction
  const skipped: StyleFunction
  const errored: StyleFunction
  const failed: StyleFunction
  const passed: StyleFunction
  const started: StyleFunction
  const unknown: StyleFunction
}

colors.theme({
  ...themeForStatusTests
})

export default colors

