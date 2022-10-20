import PintosTestController from "./PintosTestController"

export default (testControllerWrap: { controller: PintosTestController }) => {
  testControllerWrap.controller.copyTestsStatusFromResultFiles()
  testControllerWrap.controller.reflectCurrentTestsStatusInUI()
}
