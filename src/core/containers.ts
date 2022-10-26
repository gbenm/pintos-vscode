import { OptionalPromiseLike, OutputChannel } from "./types"
import { conditionalExecute } from "./utils"
import { join } from "node:path"

const defaultDevcontainerFileContent = `{
	"name": "PintOS",
	"dockerComposeFile": "./docker-compose.yml",
	"service": "pintos",
	"workspaceFolder": "/pintos",
	"shutdownAction": "stopCompose",
	"remoteUser": "pintos"
}
`

const defaultDockercomposeFileContent = `version: "3"

services:
  pintos:
    image: "gbenm/pintos"
    volumes:
      - ..:/pintos
      - ../container:/host
    command: tail -F anything
`

export async function setupDevContainer({ output, exists, mkdir, writeFile }: {
  output: OutputChannel
  writeFile: (filename: string, content: string) => OptionalPromiseLike<void>
  exists: (filename: string) => OptionalPromiseLike<boolean>
  mkdir: (folderName: string) => OptionalPromiseLike<void>
}) {
  const devcontainerDir = ".devcontainer"
  if (!await exists(devcontainerDir)) {
    await mkdir(devcontainerDir)
  }

  const devcontainerFile = join(devcontainerDir, "devcontainer.json")
  conditionalExecute({
    condition: !await exists(devcontainerFile),
    async execute() {
      await writeFile(devcontainerFile, defaultDevcontainerFileContent)
      output.appendLine(`${devcontainerFile} created successfully`)
    }
  })

  const composeFile = join(devcontainerDir, "docker-compose.yml")
  conditionalExecute({
    condition: !await exists(composeFile),
    async execute() {
      await writeFile(composeFile, defaultDockercomposeFileContent)
      output.appendLine(`${composeFile} created successfully`)
    }
  })

  const containerDir = "container/"
  conditionalExecute({
    condition: !await exists(containerDir),
    async execute() {
      await mkdir(containerDir)
      output.appendLine(`${containerDir} created successfully`)
    }
  })
}
