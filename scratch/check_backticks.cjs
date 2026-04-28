const fs = require('fs');
const content = fs.readFileSync('main.ts', 'utf8');

let inTemplate = false;
let lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let count = 0;
    for (let char of line) {
        if (char === '`') {
            inTemplate = !inTemplate;
            count++;
        }
    }
    if (count > 0) {
        console.log(`Line ${i+1} [${inTemplate ? 'IN ' : 'OUT'}]: ${line.trim()}`);
    }
}
