import { readFile, writeFile } from 'node:fs/promises';

const tag = process.env.RELEASE_TAG ?? '';
const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
if (!match) {
  console.error(`发布 tag 必须是 v1.2.3 或 v1.2.3-beta.1 格式，收到：${tag}`);
  process.exit(1);
}

const version = match[1];

async function updateJson(file, updateLockRoot = false) {
  const json = JSON.parse(await readFile(file, 'utf8'));
  json.version = version;
  if (updateLockRoot && json.packages?.['']) {
    json.packages[''].version = version;
  }
  await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
}

await updateJson('package.json');
await updateJson('package-lock.json', true);
console.log(`构建版本已设置为 ${version}`);
