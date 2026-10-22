const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

// Fix the fallthrough console.error
content = content.replace(/console\.warn\("\[Keep-Alive Error Background\]::", e\.message\);\s*\}\s*console\.error\("\[Keep-Alive Error Background\]::", e\);/g, 
`console.warn("[Keep-Alive Error Background]::", e.message);\n        return;\n      }\n      console.error("[Keep-Alive Error Background]::", e);`);

content = content.replace(/console\.warn\("\[Keep-Alive Sync Interval Error\]::", e\.message\);\s*\}\s*console\.error\("\[Keep-Alive Sync Interval Error\]::", e\);/g, 
`console.warn("[Keep-Alive Sync Interval Error]::", e.message);\n        return;\n      }\n      console.error("[Keep-Alive Sync Interval Error]::", e);`);

content = content.replace(/console\.warn\("\[Launch Keep-Alive Error Background\]::", e\.message\);\s*\}\s*console\.error\("\[Launch Keep-Alive Error Background\]::", e\);/g, 
`console.warn("[Launch Keep-Alive Error Background]::", e.message);\n        return;\n      }\n      console.error("[Launch Keep-Alive Error Background]::", e);`);

content = content.replace(/console\.warn\("\[Launch Keep-Alive Sync Error\]::", e\.message\);\s*\}\s*console\.error\("\[Launch Keep-Alive Sync Error\]::", e\);/g, 
`console.warn("[Launch Keep-Alive Sync Error]::", e.message);\n        return;\n      }\n      console.error("[Launch Keep-Alive Sync Error]::", e);`);

fs.writeFileSync('server.ts', content);
console.log("Done fixing keep-alive properly");
