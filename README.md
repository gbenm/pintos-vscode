# PintOS vscode

> **Important:** this is a testing version. the stable version is coming soon

Pintos extension, go to [pintos vscode docs](https://gbenm.github.io/pintos-utils/pintos-vscode)
for full documenation (only in spanish)

## Features

- Initial setup for PintOS
- Dev container with [gbenm/pintos](https://hub.docker.com/r/gbenm/pintos)
- Run tests
- Debugger

## Requirements

- Git
- Docker (optional)
- Linux environment (windows needs docker for this)
- Editor Config extension
- C/C++ extension (in linux)

## Extension Settings
- `pintos.buildUtils` by default true. Runs `cd utils && make` before execute "pintos health" command
- `pintos.addUtilsToPath` by default true. Adds the local `utils/` to PATH (only in this process, it doesn't change your config files)
- `pintos.phases` the folders of the phases (probably you don't need to change it)

### They're used as default for configuration (confirmation is always requested)
- `pintos.baseRepository` the repo URL to get a snapshot of pintos code
- `pintos.baseRepositoryCodeFolder` the folder containing the source code of PintOS, if your Git supports sparse checkout only clon the folder (with the original project the size will be reduced from 30MB to ~7MB)
- `pintos.personalRepoUrl` the Url of your personal repository
