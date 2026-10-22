const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

content = content.replace(/const data = await res\.json\(\);/g, 
`let data;
const contentTypeData = res.headers.get("content-type");
if (contentTypeData && contentTypeData.includes("application/json")) {
    data = await res.json();
} else {
    throw new Error("Server returned non-JSON response. Status: " + res.status);
}`);

content = content.replace(/const config = await res\.json\(\);/g, 
`let config;
const contentTypeConfig = res.headers.get("content-type");
if (contentTypeConfig && contentTypeConfig.includes("application/json")) {
    config = await res.json();
} else {
    throw new Error("Server returned non-JSON response. Status: " + res.status);
}`);

fs.writeFileSync('src/main.js', content);
console.log("Patched other res.json() calls.");
