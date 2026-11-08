import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status ?? result.signal}）`);
}
export function wails(args) {
  const version = readFileSync('go.mod', 'utf8').match(/github\.com\/wailsapp\/wails\/v3\s+(v\S+)/)?.[1];
  if (!version) throw new Error('go.mod 未声明 Wails 3 版本');
  run('go', ['run', `github.com/wailsapp/wails/v3/cmd/wails3@${version}`, ...args]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.execPath, ['scripts/build-agent.mjs', 'windows', 'amd64']);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { shell: process.platform === 'win32' });
  run('go', ['run', ...(process.platform === 'linux' ? ['-tags', 'gtk3,purego'] : []), '.']);
}
