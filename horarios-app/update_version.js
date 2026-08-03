const fs = require('fs');
const path = require('path');

// 1. Read new version from package.json
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const newVersion = packageJson.version;

console.log(`[update_version.js] Bumping to version ${newVersion}`);

// 2. Update version.json
const versionJsonPath = path.join(__dirname, 'version.json');
const versionData = { version: newVersion };
fs.writeFileSync(versionJsonPath, JSON.stringify(versionData), 'utf8');
console.log(`[update_version.js] Updated version.json`);

// 3. Update sw.js cache name
const swJsPath = path.join(__dirname, 'sw.js');
let swJsContent = fs.readFileSync(swJsPath, 'utf8');

// Regex to find something like: const CACHE_NAME = 'retail-plan-vX.Y.Z'; or retail-plan-v17
const cacheNameRegex = /const CACHE_NAME = ['"]retail-plan-v[^'"]+['"];/;
const newCacheName = `const CACHE_NAME = 'retail-plan-v${newVersion}';`;

if (cacheNameRegex.test(swJsContent)) {
    swJsContent = swJsContent.replace(cacheNameRegex, newCacheName);
    fs.writeFileSync(swJsPath, swJsContent, 'utf8');
    console.log(`[update_version.js] Updated sw.js CACHE_NAME to ${newCacheName}`);
} else {
    console.warn(`[update_version.js] WARNING: Could not find CACHE_NAME in sw.js to update.`);
}

console.log(`[update_version.js] Version bump files updated successfully.`);
