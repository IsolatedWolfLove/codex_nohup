import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const goos = process.argv[2] ?? 'windows';
const goarch = process.argv[3] ?? 'amd64';
const outputDir = path.resolve('resources/agent');
const extension = goos === 'windows' ? '.exe' : '';
const output = path.join(outputDir, `nohop-agent-${goos}-${goarch}${extension}`);
await mkdir(outputDir, { recursive: true });

const child = spawn('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', output, '.'], {
  cwd: path.resolve('agent'),
  stdio: 'inherit',
  env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
});
child.on('error', (error) => {
  console.error(`无法启动 Go 编译器：${error.message}\n请安装 Go 1.23+ 后重试。`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
