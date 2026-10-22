const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regex = /window\.switchImportTab = function\(tab\) \{[\s\S]*?        \};/;

const newFunc = `window.switchImportTab = function(tab) {
            document.getElementById('import-answer-format').value = tab;
            
            const tabs = {
                'default': { tab: document.getElementById('tab-default'), content: document.getElementById('content-default'), activeClass: 'text-blue-600 border-blue-600' },
                'underline': { tab: document.getElementById('tab-underline'), content: document.getElementById('content-underline'), activeClass: 'text-purple-600 border-purple-600' },
                'bold': { tab: document.getElementById('tab-bold'), content: document.getElementById('content-bold'), activeClass: 'text-orange-600 border-orange-600' }
            };
            
            for (const key in tabs) {
                if (key === tab) {
                    tabs[key].tab.className = \`flex-1 py-2 text-sm font-semibold \${tabs[key].activeClass} border-b-2 focus:outline-none\`;
                    tabs[key].content.classList.remove('hidden');
                } else {
                    tabs[key].tab.className = 'flex-1 py-2 text-sm font-semibold text-gray-500 border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300 focus:outline-none';
                    tabs[key].content.classList.add('hidden');
                }
            }
        };`;

content = content.replace(regex, newFunc);
fs.writeFileSync('src/main.js', content);
console.log("Patched switchImportTab.");
