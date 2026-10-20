import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installAndroidIcons } from './android-icons.mjs';
import { validateAndroidSigning } from './android-signing.mjs';

test('Android icons replace template branding in every density and adaptive launcher', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'nohop-icons-'));
  try {
    const res = path.join(project, 'app/src/main/res');
    const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
    await mkdir(path.join(res, 'values'), { recursive: true });
    for (const density of densities) {
      const dir = path.join(res, `mipmap-${density}`);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'ic_launcher.png'), 'framework icon');
      await writeFile(path.join(dir, 'ic_launcher_round.png'), 'framework icon');
    }
    await installAndroidIcons(project);
    const expected = await readFile('resources/appicon-256.png');
    for (const density of densities) {
      for (const name of ['ic_launcher', 'ic_launcher_round']) {
        assert.deepEqual(await readFile(path.join(res, `mipmap-${density}/${name}.png`)), expected);
      }
    }
    for (const name of ['ic_launcher', 'ic_launcher_round']) {
      assert.match(await readFile(path.join(res, `mipmap-anydpi-v26/${name}.xml`), 'utf8'), /@drawable\/nohop_icon_foreground/);
    }
    assert.deepEqual(await readFile(path.join(res, 'drawable-nodpi/nohop_icon.png')), expected);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('release packaging never silently falls back to an ephemeral debug certificate', () => {
  assert.throws(() => validateAndroidSigning({}), /固定签名/);
  assert.throws(() => validateAndroidSigning({ ANDROID_KEYSTORE_FILE: '/key.jks' }), /不完整/);
  const signing = { ANDROID_KEYSTORE_FILE: '/key.jks', ANDROID_KEYSTORE_PASSWORD: 'test', ANDROID_KEY_ALIAS: 'release', ANDROID_KEY_PASSWORD: 'test' };
  assert.doesNotThrow(() => validateAndroidSigning(signing));
  assert.throws(() => validateAndroidSigning({ GITHUB_REF: 'refs/tags/v3.0.0', ANDROID_ALLOW_DEBUG_SIGNING: '1' }), /固定签名/);
  assert.throws(() => validateAndroidSigning({ RELEASE_TAG: 'v3.0.0', ANDROID_ALLOW_DEBUG_SIGNING: '1' }), /固定签名/);
  assert.doesNotThrow(() => validateAndroidSigning({ ANDROID_ALLOW_DEBUG_SIGNING: '1' }));
});
