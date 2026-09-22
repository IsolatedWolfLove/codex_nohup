import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, wails } from './wails.mjs';

const target = process.argv[2] ?? (process.platform === 'win32' ? 'windows' : process.platform);
if (!['linux', 'windows'].includes(target)) throw new Error('发行构建目前支持 linux 和 windows');
if ((target === 'windows') !== (process.platform === 'win32')) throw new Error('请在对应平台构建安装包（或使用 GitHub Actions）');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const config = JSON.parse(await readFile('wails.json', 'utf8'));
config.info.productVersion = pkg.version.split('-')[0];
await writeFile('wails.json', `${JSON.stringify(config, null, 2)}\n`);
run(process.execPath, ['scripts/build-agent.mjs', 'windows', 'amd64']);
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { shell: process.platform === 'win32' });
wails(['build', '-clean', '-s', '-trimpath', '-ldflags', '-s -w', ...(target === 'linux' ? ['-tags', 'webkit2_41'] : ['-nsis'])]);
await mkdir('release', { recursive: true });
if (target === 'windows') {
  await cp('build/bin/nohop-codex.exe', `release/nohop-codex-${pkg.version}-windows-amd64.exe`);
  await cp('build/bin/nohop-codex-amd64-installer.exe', `release/nohop-codex-${pkg.version}-windows-amd64-installer.exe`);
} else {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  run('tar', ['-czf', `release/nohop-codex-${pkg.version}-linux-${arch}.tar.gz`, '-C', 'build/bin', 'nohop-codex']);
  const root = path.resolve(`build/deb-${arch}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, 'DEBIAN'), { recursive: true });
  await mkdir(path.join(root, 'usr/bin'), { recursive: true });
  await mkdir(path.join(root, 'usr/share/applications'), { recursive: true });
  await mkdir(path.join(root, 'usr/share/icons/hicolor/256x256/apps'), { recursive: true });
  await cp('build/bin/nohop-codex', path.join(root, 'usr/bin/nohop-codex'));
  await cp('resources/appicon-256.png', path.join(root, 'usr/share/icons/hicolor/256x256/apps/nohop-codex.png'));
  await writeFile(path.join(root, 'DEBIAN/control'), `Package: nohop-codex\nVersion: ${pkg.version.replace('-', '~')}\nArchitecture: ${arch}\nMaintainer: IsolatedWolfLove\nDepends: libgtk-3-0, libwebkit2gtk-4.1-0\nSection: utils\nPriority: optional\nDescription: Persistent SSH terminal sessions for Linux and Windows servers\n`);
  await writeFile(path.join(root, 'usr/share/applications/nohop-codex.desktop'), '[Desktop Entry]\nType=Application\nName=Nohop Codex\nIcon=nohop-codex\nExec=nohop-codex\nTerminal=false\nCategories=Development;Utility;\n');
  run('dpkg-deb', ['--root-owner-group', '--build', root, `release/nohop-codex-${pkg.version}-linux-${arch}.deb`]);
}
