import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The runtime apiVersion is the WAM API spec version, so it comes from the upstream package (devDependency),
// not from the wam-api fork, whose npm version carries a "-fork.N" suffix.
const packageFilePath = path.join(__dirname, '../node_modules/@webaudiomodules/api/package.json');
const { version } = JSON.parse(fs.readFileSync(packageFilePath, 'utf-8'));

const versionFilePath = path.join(__dirname, './apiVersion.js');
if (fs.existsSync(versionFilePath)) fs.unlinkSync(versionFilePath);

fs.writeFileSync(versionFilePath, `export default ${JSON.stringify(version)};\n`);

console.log("API version file generated.");
