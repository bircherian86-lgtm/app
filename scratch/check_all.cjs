const fs = require('fs');
const content = fs.readFileSync('electron-main.cjs', 'utf8');
let stackP = [];
let stackB = [];
let lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  for (let j = 0; j < line.length; j++) {
    if (line[j] === '(') stackP.push({ line: i + 1, char: j + 1 });
    else if (line[j] === ')') {
      if (stackP.length === 0) console.log('Extra ) at', i + 1, j + 1);
      else stackP.pop();
    }
    if (line[j] === '{') stackB.push({ line: i + 1, char: j + 1 });
    else if (line[j] === '}') {
      if (stackB.length === 0) console.log('Extra } at', i + 1, j + 1);
      else stackB.pop();
    }
  }
}
stackP.forEach(s => console.log('Unclosed ( at', s.line, s.char));
stackB.forEach(s => console.log('Unclosed { at', s.line, s.char));
