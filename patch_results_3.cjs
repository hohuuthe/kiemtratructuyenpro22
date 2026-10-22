const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

content = content.replace(
    /<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3 mb-4">/g,
    '<div class="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 mb-4">'
);
content = content.replace(
    /<div class="p-3 bg-purple-50 rounded-lg text-center shadow-sm border border-purple-100\/50 flex flex-col justify-center">/g,
    '<div class="col-span-2 md:col-span-1 p-3 bg-purple-50 rounded-lg text-center shadow-sm border border-purple-100/50 flex flex-col justify-center">'
);

// We need to also make sure the details container has proper spacing and padding on mobile.
// Specifically the `p-4` might be a bit too big on small screens, let's make it `p-3 sm:p-4`.
content = content.replace(
    /<div class="p-4 border-2 rounded-lg \$\{statusClass\} mb-0 overflow-hidden shadow-sm">/g,
    '<div class="p-3 sm:p-4 border-2 rounded-lg ${statusClass} mb-0 overflow-hidden shadow-sm">'
);

fs.writeFileSync('src/main.js', content);
console.log("Results layout tweaked step 3.");
