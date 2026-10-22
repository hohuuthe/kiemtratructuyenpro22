const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// The first formatTime is inside showResults around line 5707. We will change it to return mm:ss
const regex = /const formatTime = \(seconds\) => \{\s*const m = Math\.floor\(seconds \/ 60\);\s*const s = seconds % 60;\s*return `\$\{m\} phút \$\{s\} giây`;\s*\};/g;

// Only replace the first one or we can just replace all of them with mm:ss to be safe.
let matches = 0;
content = content.replace(regex, (match) => {
    matches++;
    if (matches === 1) { // Only inside showResults
        return `const formatTime = (seconds) => {
                const m = Math.floor(seconds / 60);
                const s = seconds % 60;
                return \`\${m}:\${String(s).padStart(2, '0')}\`;
            };`;
    }
    return match; // Keep others the same if any
});

fs.writeFileSync('src/main.js', content);
console.log("Time format patched for showResults.");
