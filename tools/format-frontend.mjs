import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv.includes('--write') ? 'write' : 'check';
const rootDir = path.basename(process.cwd()) === 'frontend'
    ? process.cwd()
    : path.resolve(process.cwd(), 'frontend');
const exts = new Set(['.js', '.css', '.html']);
const changedFiles = [];

walk(rootDir);

if (mode === 'check' && changedFiles.length > 0) {
    console.warn('Formatting changes suggested:');
    changedFiles.forEach((file) => console.warn(`- ${file}`));
    process.exit(0);
}

console.log(mode === 'write' ? 'Frontend formatting normalized.' : 'Frontend formatting looks good.');

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath);
            continue;
        }

        if (!exts.has(path.extname(entry.name))) continue;
        formatFile(fullPath);
    }
}

function formatFile(filePath) {
    const original = fs.readFileSync(filePath, 'utf8');
    const formatted = original
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n*$/, '\n');

    if (formatted === original) return;

    changedFiles.push(relative(filePath));
    if (mode === 'write') {
        fs.writeFileSync(filePath, formatted, 'utf8');
    }
}

function relative(filePath) {
    return path.relative(process.cwd(), filePath).replaceAll('\\', '/');
}
