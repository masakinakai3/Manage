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

        if (path.extname(filePath) === '.css') {
            const trimmed = line.trim();
            const colonIndex = line.indexOf(':');
            const declarationValue = colonIndex >= 0 ? line.slice(colonIndex + 1) : '';
            const hasColorLiteral = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(declarationValue);
            if (hasColorLiteral && !trimmed.startsWith('--')) {
                issues.push(`${relative(filePath)}:${index + 1} uses a color literal outside a design token`);
            }

            const fontSize = line.match(/font-size:\s*([0-9.]+)(px|rem)/);
            if (fontSize) {
                const pixels = fontSize[2] === 'rem' ? Number.parseFloat(fontSize[1]) * 16 : Number.parseFloat(fontSize[1]);
                if (pixels < 13 && !trimmed.startsWith('--')) {
                    issues.push(`${relative(filePath)}:${index + 1} uses text smaller than the 13px minimum`);
                }
            }
        }
    });
}

function relative(filePath) {
    return path.relative(process.cwd(), filePath).replaceAll('\\', '/');
}
