const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// The line is: <p class="font-semibold text-gray-800 text-sm md:text-base lg:text-lg mb-2 break-words overflow-hidden text-ellipsis">
content = content.replace(
    /text-sm md:text-base lg:text-lg mb-2 break-words overflow-hidden text-ellipsis/g,
    'text-sm md:text-base lg:text-lg mb-2 break-words'
);

fs.writeFileSync('src/main.js', content);
console.log("Ellipsis fixed.");
