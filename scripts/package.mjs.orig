import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const environment = { ...process.env };
delete environment.GH_TOKEN;
delete environment.GITHUB_TOKEN;

const executable = path.resolve(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);
const args = [...process.argv.slice(2), '--publish', 'never'];
const child = spawn(executable, args, { env: environment, stdio: 'inherit' });
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
