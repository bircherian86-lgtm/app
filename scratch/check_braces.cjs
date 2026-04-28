const fs = require('fs');
const content = fs.readFileSync('electron-main.cjs', 'utf8');
let stack = [];
let lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  for (let j = 0; j < line.length; j++) {
    if (line[j] === '{') stack.push({ line: i + 1, char: j + 1 });
    else if (line[j] === '}') {
      if (stack.length === 0) console.log('Extra } at', i + 1, j + 1);
      else stack.pop();
    }
  }
}
stack.forEach(s => console.log('Unclosed { at', s.line, s.char));
