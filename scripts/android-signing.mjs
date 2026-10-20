import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Never silently change a release's certificate by falling back to a new debug key.
export function validateAndroidSigning(env) {
  const keys = ['ANDROID_KEYSTORE_FILE', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'];
  const configured = keys.filter(key => !!env[key]?.trim());
  if (configured.length === keys.length) return;
  if (configured.length) throw new Error(`Android 签名配置不完整，缺少：${keys.filter(key => !env[key]?.trim()).join(', ')}`);
  if (env.ANDROID_ALLOW_DEBUG_SIGNING === '1' && !env.RELEASE_TAG && !env.GITHUB_REF?.startsWith('refs/tags/')) {
    console.warn('使用调试签名构建本地测试 APK；此 APK 不保证可覆盖正式版本。');
    return;
  }
  throw new Error('Android 打包必须配置固定签名：ANDROID_KEYSTORE_FILE、ANDROID_KEYSTORE_PASSWORD、ANDROID_KEY_ALIAS、ANDROID_KEY_PASSWORD；仅本地测试可显式设置 ANDROID_ALLOW_DEBUG_SIGNING=1');
}

export function verifyAndroidSigningCertificate(env) {
  if (!env.ANDROID_KEYSTORE_FILE) return; // Explicit local debug build.
  const cert = execFileSync('keytool', ['-exportcert', '-keystore', env.ANDROID_KEYSTORE_FILE, '-alias', env.ANDROID_KEY_ALIAS, '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const actual = createHash('sha256').update(cert).digest('hex');
  const expected = readFileSync('resources/android/release-signing.sha256', 'utf8').trim();
  if (actual !== expected) throw new Error('Android 签名证书与固定发布证书不一致，拒绝更换签名');
}
