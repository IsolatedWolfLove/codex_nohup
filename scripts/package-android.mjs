import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { run } from './wails.mjs';
import { installAndroidDownloads } from './android-downloads.mjs';

if (process.platform !== 'linux') throw new Error('Android 打包请使用 Linux 或 GitHub Actions');
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('请设置 ANDROID_HOME 并安装 SDK 35 和 NDK 28.2.13676358');
const ndk = process.env.ANDROID_NDK_HOME ?? path.join(sdk, 'ndk/28.2.13676358');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
run('go', ['mod', 'download', 'github.com/wailsapp/wails/v3']);
const moduleInfo = JSON.parse(execFileSync('go', ['list', '-m', '-json', 'github.com/wailsapp/wails/v3'], { encoding: 'utf8' }));
if (!moduleInfo.Dir) throw new Error('请先执行 go mod download');
// Use Java/JNI hosts from the exact same pinned version as the Go framework.
const template = path.join(moduleInfo.Dir, 'internal/commands/build_assets/android');
const project = path.resolve('build/android');
async function makeWritable(dir) {
  await chmod(dir, 0o755);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await makeWritable(file);
    else await chmod(file, 0o644);
  }
}
// Go module caches are read-only; fs.cp preserves those file permissions.
try { await makeWritable(project); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(project, { recursive: true, force: true });
await cp(template, project, { recursive: true });
await makeWritable(project);
await installAndroidDownloads(project);
async function edit(file, change) {
  const target = path.join(project, file);
  await writeFile(target, change(await readFile(target, 'utf8')));
}
await edit('app/build.gradle', text => text
  .replace('applicationId "com.wails.app"', 'applicationId "com.nohop.codex"')
  .replace('minSdk 21', 'minSdk 26')
  .replace('versionCode 1', `versionCode ${process.env.ANDROID_VERSION_CODE ?? 1}`)
  .replace('versionName "1.0"', `versionName "${pkg.version}"`)
  .replace("abiFilters 'arm64-v8a', 'x86_64'", "abiFilters 'arm64-v8a'"));
await edit('gradle/wrapper/gradle-wrapper.properties', text => text.replace('gradle-9.2.1-bin.zip', 'gradle-8.9-bin.zip'));
await edit('app/src/main/res/values/strings.xml', text => text.replace('Wails App', 'Nohop Codex'));
await edit('app/src/main/res/layout/activity_main.xml', text => text.replace('android:id="@+id/main_container"', 'android:id="@+id/main_container" android:fitsSystemWindows="true"'));
await edit('app/src/main/AndroidManifest.xml', text => text
  .replace('android:allowBackup="true"', 'android:allowBackup="false"')
  .replace(/^.*<uses-permission android:name="android.permission.(?:VIBRATE|USE_BIOMETRIC|POST_NOTIFICATIONS|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|CAMERA|FOREGROUND_SERVICE|FOREGROUND_SERVICE_DATA_SYNC)" \/>\s*$/gm, '')
  .replace(/\s*<queries>[\s\S]*?<\/queries>/, '')
  .replace(/\s*<service[\s\S]*?\/>/, ''));
await cp('resources/appicon-256.png', path.join(project, 'app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'));
await cp('resources/appicon-256.png', path.join(project, 'app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png'));
await writeFile(path.join(project, 'local.properties'), `sdk.dir=${sdk}\n`);
run(process.execPath, ['scripts/build-agent.mjs', 'windows', 'amd64']);
run('npm', ['run', 'build:android']);
const libs = path.join(project, 'app/src/main/jniLibs/arm64-v8a');
await mkdir(libs, { recursive: true });
const toolchain = path.join(ndk, 'toolchains/llvm/prebuilt/linux-x86_64/bin');
run('go', ['build', '-buildmode=c-shared', '-tags', 'production', '-trimpath', '-buildvcs=false', '-ldflags', '-s -w -extldflags=-Wl,-z,max-page-size=16384,-z,common-page-size=16384', '-o', path.join(libs, 'libwails.so'), '.'], {
  env: { ...process.env, GOOS: 'android', GOARCH: 'arm64', CGO_ENABLED: '1',
    CC: path.join(toolchain, 'aarch64-linux-android26-clang'), CXX: path.join(toolchain, 'aarch64-linux-android26-clang++') },
});
await chmod(path.join(project, 'gradlew'), 0o755);
run('./gradlew', ['--no-daemon', 'assembleRelease'], { cwd: project });
await mkdir('release', { recursive: true });
const output = `release/nohop-codex-${pkg.version}-android-arm64.apk`;
await cp(path.join(project, 'app/build/outputs/apk/release/app-release.apk'), output);
console.log(`APK: ${output}`);
