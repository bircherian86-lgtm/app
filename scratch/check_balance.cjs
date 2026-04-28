const fs = require('fs');
const content = fs.readFileSync('main.ts', 'utf8');

let balance = 0;
let lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/{/g) || []).length;
    const closes = (line.match(/}/g) || []).length;
    balance += opens - closes;
    if (balance < 0) {
        console.log(`Unbalance at line ${i + 1}: ${balance}`);
        balance = 0; // reset to keep going
    }
}
console.log(`Final balance: ${balance}`);
