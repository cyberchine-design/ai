const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STORAGE_DIR = path.join(__dirname, '..', '..', 'storage');
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} -> ${dest}...`);
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`Downloaded successfully: ${dest}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  const dingTarGz = path.join(STORAGE_DIR, 'ding-1.9.tar.gz');
  const enThJsonPath = path.join(STORAGE_DIR, 'eng2thai_raw.json');

  try {
    // 1. Download files
    await downloadFile('https://ftp.tu-chemnitz.de/pub/Local/urz/ding/ding-1.9.tar.gz', dingTarGz);
    await downloadFile('https://raw.githubusercontent.com/pureexe/node-thaidict/master/data/eng2thai.json', enThJsonPath);

    // 2. Extract using system tar
    console.log('Extracting German-English database...');
    try {
      execSync(`tar -xzf "${dingTarGz}" -C "${STORAGE_DIR}"`);
      console.log('Extraction complete.');
    } catch (e) {
      console.error('System tar failed. Trying raw extract with tar without directory flag...', e.message);
      execSync(`cd "${STORAGE_DIR}" && tar -xzf "ding-1.9.tar.gz"`);
    }

    // Locate extracted file (should be inside ding-1.9 folder)
    let extractedFile = path.join(STORAGE_DIR, 'ding-1.9', 'de-en.txt');
    if (!fs.existsSync(extractedFile)) {
      extractedFile = path.join(STORAGE_DIR, 'de-en.txt');
    }

    if (!fs.existsSync(extractedFile)) {
      throw new Error('Could not locate extracted de-en.txt file.');
    }

    // 3. Parse German-English DING file
    console.log('Parsing German-English database...');
    const deEnData = fs.readFileSync(extractedFile, 'utf-8');
    const lines = deEnData.split('\n');
    const deEnMap = {};

    const addMapping = (key, val) => {
      if (!key) return;
      if (deEnMap[key]) {
        const existingTrans = deEnMap[key].split(' | ').map(t => t.trim());
        if (!existingTrans.includes(val)) {
          deEnMap[key] = deEnMap[key] + ' | ' + val;
        }
      } else {
        deEnMap[key] = val;
      }
    };

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;

      const parts = line.split(' :: ');
      if (parts.length < 2) continue;

      const deRaw = parts[0].trim();
      const enRaw = parts[1].trim();

      const enClean = enRaw.replace(/\[.*?\]|\{.*?\}/g, '').replace(/\s+/g, ' ').trim();

      // Split by pipe
      const deParts = deRaw.split('|');
      const enParts = enRaw.split('|');
      const isEqualLength = deParts.length === enParts.length;

      for (let i = 0; i < deParts.length; i++) {
        const rawPart = deParts[i];
        const enVal = isEqualLength
          ? enParts[i].replace(/\[.*?\]|\{.*?\}/g, '').replace(/\s+/g, ' ').trim()
          : enClean;

        const cleanedPart = rawPart.replace(/\[.*?\]|\{.*?\}/g, '').replace(/\(.*?\)/g, '').trim().toLowerCase();
        const subParts = cleanedPart.split(';');
        for (const subPart of subParts) {
          let clean = subPart.trim();
          if (!clean) continue;

          const baseWord = clean.replace(/^(der|die|das|ein|eine|einen|einem|einer|eines)\s+/, '').trim();
          if (baseWord) {
            addMapping(baseWord, enVal);
            if (clean !== baseWord) {
              addMapping(clean, enVal);
            }

            // Check for inflections like "ich/er/sie schuf" or "er/sie/es/man war" or "ich/er/sie stank"
            const inflectionMatch = clean.match(/(?:\b(?:ich|er|sie|es|wir|ihr|man|du)\b|\/)+\s+(\w+)/i);
            if (inflectionMatch) {
              const verb = inflectionMatch[1];
              if (verb && verb.length > 2) {
                const wordCount = enVal.split(/\s+/).filter(Boolean).length;
                const isSentence = /[.!?]/.test(enVal);
                if (wordCount <= 3 && !isSentence) {
                  addMapping(verb, enVal);
                }
              }
            }
          }
        }
      }
    }

    const deEnDest = path.join(STORAGE_DIR, 'de-en.json');
    fs.writeFileSync(deEnDest, JSON.stringify(deEnMap, null, 2));
    console.log(`German-English compiled: ${Object.keys(deEnMap).length} entries saved to ${deEnDest}`);

    // 4. Parse English-Thai LEXiTRON file
    console.log('Parsing English-Thai database...');
    const enThRawData = JSON.parse(fs.readFileSync(enThJsonPath, 'utf-8'));
    const enThMap = {};

    for (const item of enThRawData) {
      if (item.search && item.result) {
        const enWord = item.search.trim().toLowerCase();
        enThMap[enWord] = item.result.trim();
      }
    }

    const enThDest = path.join(STORAGE_DIR, 'en-th.json');
    fs.writeFileSync(enThDest, JSON.stringify(enThMap, null, 2));
    console.log(`English-Thai compiled: ${Object.keys(enThMap).length} entries saved to ${enThDest}`);

    // Clean up temporary/raw files to save space
    console.log('Cleaning up files...');
    if (fs.existsSync(dingTarGz)) fs.unlinkSync(dingTarGz);
    
    const dingFolder = path.join(STORAGE_DIR, 'ding-1.9');
    if (fs.existsSync(dingFolder)) {
      fs.rmSync(dingFolder, { recursive: true, force: true });
    }
    
    if (fs.existsSync(enThJsonPath)) fs.unlinkSync(enThJsonPath);

    console.log('Dictionary preparation successfully completed! 🎉');
  } catch (err) {
    console.error('Error compiling dictionaries:', err);
  }
}

main();
