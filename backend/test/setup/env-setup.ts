import * as fs from 'fs';
import { ENV_FILE } from './env-file';

// Runs inside each test file's own environment (unlike globalSetup), so
// process.env mutations here are actually visible to the test module.
const written = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8')) as Record<string, string>;
Object.assign(process.env, written);
