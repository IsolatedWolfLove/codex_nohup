import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';

const environment = { ...process.env };
delete environment.GH_TOKEN;
delete environment.GITHUB_TOKEN;

const require = createRequire(import.meta.url);
const electronBuilderCli = require.resolve('electron-builder/out/cli/cli.js');
const args = [...process.argv.slice(2), '--publish', 'never'];
const child = spawn(process.execPath, [electronBuilderCli, ...args], {
  env: environment,
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
