import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

// Patch the generated host on every build; never edit the module cache.
export async function installAndroidDownloads(project) {
  const java = path.join(project, 'app/src/main/java/com/wails/app');
  const file = path.join(java, 'MainActivity.java');
  let text = await readFile(file, 'utf8');
  const changes = [
    ['webView.addJavascriptInterface(new WailsJSBridge(bridge, webView), "wails");',
     'webView.addJavascriptInterface(new WailsJSBridge(bridge, webView), "wails");\n        nohopDownloads = new NoHopDownloads(this, webView);\n        webView.addJavascriptInterface(nohopDownloads, "nohopDownloads");'],
    ['        super.onActivityResult(requestCode, resultCode, data);',
     '        super.onActivityResult(requestCode, resultCode, data);\n        if (nohopDownloads != null && nohopDownloads.onActivityResult(requestCode, resultCode, data)) return;'],
    ['        super.onDestroy();',
     '        if (nohopDownloads != null) nohopDownloads.destroy();\n        super.onDestroy();'],
  ];
  for (const [anchor, replacement] of changes) {
    if (text.split(anchor).length !== 2) throw new Error(`Android download host patch anchor changed: ${anchor}`);
    text = text.replace(anchor, replacement);
  }
  // Field goes before the existing onCreate annotation so @Override still decorates onCreate.
  const anchor = '    @Override\n    protected void onCreate';
  if (!text.includes(anchor)) throw new Error('Android onCreate declaration changed');
  text = text.replace(anchor, '    private NoHopDownloads nohopDownloads;\n\n' + anchor);
  await writeFile(file, text);
  await copyFile('resources/android/NoHopDownloads.java', path.join(java, 'NoHopDownloads.java'));
}
