import { writeFileSync } from 'fs';

const version = {
  version: Date.now().toString(),
  buildTime: new Date().toISOString()
};

writeFileSync('public/version.json', JSON.stringify(version, null, 2));
console.log('[generate-version] Created version.json:', version);
