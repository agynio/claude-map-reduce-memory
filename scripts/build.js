const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const nodeModulesPath = path.join(projectRoot, 'node_modules')

if (!fs.existsSync(nodeModulesPath)) {
  execSync('npm install --ignore-scripts --include=dev --no-audit --no-fund', {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_global: 'false',
      npm_config_prefix: projectRoot
    }
  })
}

execSync('npm exec --yes --package typescript@5.8.3 -- tsc', {
  cwd: projectRoot,
  stdio: 'inherit'
})
