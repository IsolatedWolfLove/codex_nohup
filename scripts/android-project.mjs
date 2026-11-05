// Wails templates have used both Groovy method calls and property assignments.
export function configureAndroidBuild(text, version, versionCode = 1) {
  const changes = [
    [/\bapplicationId\s*(?:=\s*)?"com\.wails\.app"/, 'applicationId = "com.nohop.codex"'],
    [/\bminSdk\s*(?:=\s*)?21\b/, 'minSdk = 26'],
    [/\bversionCode\s*(?:=\s*)?1\b/, `versionCode = ${versionCode}`],
    [/\bversionName\s*(?:=\s*)?"1\.0"/, `versionName = ${JSON.stringify(version)}`],
    [/abiFilters 'arm64-v8a', 'x86_64'/, "abiFilters 'arm64-v8a'"],
  ];
  for (const [pattern, value] of changes) {
    if (!pattern.test(text)) throw new Error(`Android build template changed: ${pattern}`);
    text = text.replace(pattern, () => value);
  }
  return text;
}
