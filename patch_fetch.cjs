const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// We'll replace instances of:
// const resJson = await res.json();
// with a safer version that checks the content type first.

content = content.replace(/const resJson = await res\.json\(\);/g, 
`let resJson;
const contentType = res.headers.get("content-type");
if (contentType && contentType.includes("application/json")) {
    resJson = await res.json();
} else {
    throw new Error("Server returned non-JSON response (likely 502/504 during restart). Status: " + res.status);
}`);

fs.writeFileSync('src/main.js', content);
console.log("Patched res.json() calls.");
