import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const target = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'chelectronic', 'cajero');
const source = path.join(root, 'android-template', 'app', 'src', 'main', 'java', 'com', 'chelectronic', 'cajero');

try {
  await fs.access(path.join(root, 'android', 'app', 'build.gradle'));
} catch {
  console.error('No existe android/app/build.gradle. Ejecuta primero: npx cap add android');
  process.exit(1);
}

await fs.mkdir(target, { recursive: true });
for (const name of ['MainActivity.java', 'SQLiteBridgePlugin.java', 'ScannerBridgePlugin.java', 'FilePickerPlugin.java']) {
  await fs.copyFile(path.join(source, name), path.join(target, name));
}

const appGradle = path.join(root, 'android', 'app', 'build.gradle');
let gradle = await fs.readFile(appGradle, 'utf8');
// Mantener la versión de Android sincronizada con el proyecto fuente.
gradle = gradle.replace(/versionCode\s+\d+/, 'versionCode 4');
gradle = gradle.replace(/versionName\s+['\"][^'\"]+['\"]/, 'versionName \"2.0.0\"');
await fs.writeFile(appGradle, gradle);
if (process.env.ANDROID_KEYSTORE_PATH && !gradle.includes('CH_CAJERO_RELEASE_SIGNING')) {
  gradle += `\n\n// CH_CAJERO_RELEASE_SIGNING\nandroid {\n    signingConfigs {\n        release {\n            storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))\n            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')\n            keyAlias System.getenv('ANDROID_KEY_ALIAS')\n            keyPassword System.getenv('ANDROID_KEY_PASSWORD')\n        }\n    }\n    buildTypes {\n        release { signingConfig signingConfigs.release }\n    }\n}\n`;
  await fs.writeFile(appGradle, gradle);
}

console.log('Android preparado: SQLiteBridge, ScannerBridge y FilePicker integrados.');
