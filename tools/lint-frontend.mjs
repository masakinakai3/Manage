import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.basename(process.cwd()) === 'frontend'
    ? process.cwd()
    : path.resolve(process.cwd(), 'frontend');
const exts = new Set(['.js', '.css', '.html']);
const issues = [];

walk(rootDir);

if (issues.length > 0) {
    console.error('Lint issues found:');
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
}

console.log('Frontend lint checks passed.');

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath);
            continue;
        }

        if (!exts.has(path.extname(entry.name))) continue;
        lintFile(fullPath);
    }
}

function lintFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
        if (/\t/.test(line)) {
            issues.push(`${relative(filePath)}:${index + 1} contains a tab character`);
        }
        if (/[ \t]+$/.test(line)) {
            issues.push(`${relative(filePath)}:${index + 1} has trailing whitespace`);
        }
    });
}

function relative(filePath) {
    return path.relative(process.cwd(), filePath).replaceAll('\\', '/');
}
