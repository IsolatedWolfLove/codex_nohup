import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function installAndroidIcons(project) {
  const res = path.join(project, 'app/src/main/res');
  // Replace every density, not just xxxhdpi: Android selects the closest resource.
  for (const entry of await readdir(res, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^mipmap-(?:l|m|h|xh|xxh|xxxh)dpi$/.test(entry.name)) continue;
    for (const name of ['ic_launcher', 'ic_launcher_round']) {
      await copyFile('resources/appicon-256.png', path.join(res, entry.name, `${name}.png`));
    }
  }
  await mkdir(path.join(res, 'drawable-nodpi'), { recursive: true });
  await copyFile('resources/appicon-256.png', path.join(res, 'drawable-nodpi/nohop_icon.png'));
  await mkdir(path.join(res, 'drawable'), { recursive: true });
  await writeFile(path.join(res, 'drawable/nohop_icon_foreground.xml'), `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android" android:inset="18%">
  <bitmap android:src="@drawable/nohop_icon" android:gravity="fill" />
</inset>
`);
  // Adaptive icons are used on our minimum supported Android version (8.0).
  await mkdir(path.join(res, 'mipmap-anydpi-v26'), { recursive: true });
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    await writeFile(path.join(res, `mipmap-anydpi-v26/${name}.xml`), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/nohop_icon_background" />
  <foreground android:drawable="@drawable/nohop_icon_foreground" />
</adaptive-icon>
`);
  }
  await writeFile(path.join(res, 'values/nohop_icon.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="nohop_icon_background">#080d12</color></resources>\n');
}
