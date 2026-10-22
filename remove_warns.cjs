const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

// replace console.warn that logs the quota error with nothing or console.log
content = content.replace(/console\.warn\("[^"]+::", [^\)]+\);/g, `// quota error logged as 503`);
content = content.replace(/console\.warn\("API Error \(Quota exceeded\):", [^\)]+\);/g, `// quota error logged as 503`);
content = content.replace(/console\.warn\("\[[^\]]+\]::", [^\)]+\);/g, `// quota error logged as 503`);

fs.writeFileSync('server.ts', content);
console.log("Done");
