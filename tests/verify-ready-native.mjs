import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../capacitor.config.json', import.meta.url)));
assert.equal(config.appId, 'kr.co.breeze.ready');
assert.equal(config.appName, 'READY');
assert.equal(config.webDir, 'dist');
assert.equal(config.server?.url, undefined, 'native shell must bundle the same web build, not point at a second runtime');

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
assert.match(packageJson.scripts['native:sync'], /native:build/, 'native sync must use the student-only bundle');
const build = await readFile(new URL('../tools/build-pages.mjs', import.meta.url), 'utf8');
assert.match(build, /READY_NATIVE_BUILD/);
assert.match(build, /rm\(resolve\(output, 'admin'\)/, 'native bundle must remove Admin routes and assets');

const info = await readFile(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
assert.equal((info.match(/UIInterfaceOrientationPortrait/g) || []).length, 2, 'iPhone and iPad should both be portrait-only');
assert.doesNotMatch(info, /UIInterfaceOrientationLandscape/);
assert.match(info, /<key>UIRequiresFullScreen<\/key>\s*<true\/>/, 'portrait-only iPad builds must opt out of multitasking rotation');

const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
assert.match(manifest, /android:screenOrientation="portrait"/);
assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
assert.match(manifest, /android\.permission\.INTERNET/);

console.log('READY thin native shell contract verified');
