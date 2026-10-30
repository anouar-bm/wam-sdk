import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// WamEnv.apiVersion = the installed wam-api version (the API this SDK implements), e.g. "2.0.0-alpha.7-fork.0".
// The "-fork.N" suffix is safe: hosts only read this string; plugin compatibility uses the descriptor's apiVersion ("2.0.0").
const packageFilePath = path.join(__dirname, '../node_modules/wam-api/package.json');
const { version } = JSON.parse(fs.readFileSync(packageFilePath, 'utf-8'));

const versionFilePath = path.join(__dirname, './apiVersion.js');
if (fs.existsSync(versionFilePath)) fs.unlinkSync(versionFilePath);

fs.writeFileSync(versionFilePath, `export default ${JSON.stringify(version)};\n`);

console.log("API version file generated.");
