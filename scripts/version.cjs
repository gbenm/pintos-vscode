/**
 * create a new version of the package, tag the version and sign it
 */
const { spawnSync, execSync } = require("node:child_process")

const message = (version) => `"chore: 🤖 ${version}"`
const execute = ([cmd, ...args]) => spawnSync(cmd, args, { shell: true, stdio: "inherit" })


execute(["npm", "version", "--no-git-tag-version", process.argv.slice(2)])


const versionInfo = JSON.parse(execSync("npm version --json"))
const version = `v${versionInfo["pintos"]}`
execute(["git", "add", "."])
execute(["git", "commit", "-m", message(version)])
execute(["git", "tag", "-s", "-m", version, version])
