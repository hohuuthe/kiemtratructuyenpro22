const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Reduce button size by ~30% (width/height from 8->6 or 7, 9->7 or 8)
content = content.replace(
    /class="question-nav-btn w-8 h-8 md:w-9 md:h-9 text-xs md:text-sm rounded-lg font-semibold transition-all duration-200 \$\{btnClass\}"/g,
    'class="question-nav-btn w-6 h-6 md:w-7 md:h-7 text-[10px] md:text-xs rounded-md font-semibold transition-all duration-200 ${btnClass}"'
);

fs.writeFileSync('src/main.js', content);
console.log("Patched src/main.js renderQuestionNav");
