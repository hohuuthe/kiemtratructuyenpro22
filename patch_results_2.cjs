const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regexMainRow = /<p class="font-semibold text-gray-800 text-lg mb-2 break-words">Câu \${i \+ 1}: \${formatContent\(d.question.content\)}<\/p>/g;
const newMainRow = '<p class="font-semibold text-gray-800 text-sm md:text-base lg:text-lg mb-2 break-words overflow-hidden text-ellipsis">Câu ${i + 1}: ${formatContent(d.question.content)}</p>';
content = content.replace(regexMainRow, newMainRow);

// Change image styles
const imgRegex = /<img src="\${d.question.image}" class="max-w-full h-auto mb-2 rounded border">/g;
const newImg = '<img src="${d.question.image}" class="max-w-full h-auto mb-2 rounded border shadow-sm" style="max-height: 250px; object-fit: contain;">';
content = content.replace(imgRegex, newImg);

// Re-adjust score summary sizes
content = content.replace(
    /text-3xl md:text-4xl font-black text-blue-600/g,
    'text-3xl sm:text-4xl lg:text-5xl font-black text-blue-600'
);
content = content.replace(
    /text-3xl md:text-4xl font-black text-green-600/g,
    'text-2xl sm:text-3xl lg:text-4xl font-black text-green-600'
);
content = content.replace(
    /text-3xl md:text-4xl font-black text-purple-600/g,
    'text-2xl sm:text-3xl lg:text-4xl font-black text-purple-600'
);

fs.writeFileSync('src/main.js', content);
console.log("Results layout tweaked further.");
