const fs = require('fs');

// 1. Fix closeModal in main.js
let mainContent = fs.readFileSync('src/main.js', 'utf8');

const oldCloseModal = `        function closeModal() {
            const container = document.getElementById('modal-container');
            if (container) {
                container.classList.add('hidden');
            }
        }`;

const newCloseModal = `        function closeModal() {
            const container = document.getElementById('modal-container');
            if (container) {
                container.classList.add('hidden');
                setTimeout(() => {
                    const el = document.getElementById('modal-content');
                    if (el) el.innerHTML = '';
                }, 300);
            }
        }`;

mainContent = mainContent.replace(oldCloseModal, newCloseModal);

// 2. Rename hs-fullname and hs-unit to something that doesn't trigger heuristics
mainContent = mainContent.replace(/hs-fullname/g, 'guest_data_1');
mainContent = mainContent.replace(/hs-unit/g, 'guest_data_2');

fs.writeFileSync('src/main.js', mainContent);

// 3. Fix tab-exam.html
function patchHtml(filepath) {
    if (!fs.existsSync(filepath)) return;
    let content = fs.readFileSync(filepath, 'utf8');
    
    // Replace hs-fullname
    content = content.replace(/id="hs-fullname"/g, 'id="guest_data_1"');
    content = content.replace(/name="hs-fullname-ignore"/g, '');
    
    // Replace hs-unit
    content = content.replace(/id="hs-unit"/g, 'id="guest_data_2"');
    content = content.replace(/name="hs-unit-ignore"/g, '');
    
    // Change autocomplete
    content = content.replace(/autocomplete="off"/g, 'autocomplete="nope" readonly onfocus="this.removeAttribute(\'readonly\')"');

    fs.writeFileSync(filepath, content);
}

patchHtml('public/components/tab-exam.html');
patchHtml('dist/components/tab-exam.html');

console.log("Patched closeModal and input fields.");
