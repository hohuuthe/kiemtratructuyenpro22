const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldModalStr = `                    <div class="flex flex-row justify-end gap-2 shrink-0 mt-1">
                        <button onclick="closeModal()" class="flex-1 sm:flex-none px-3 py-2 sm:px-4 sm:py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition text-sm text-center border border-gray-200 active:scale-95">
                            \${cancelText}
                        </button>
                        <button id="confirm-modal-btn" class="flex-1 sm:flex-none px-4 py-2 sm:px-5 sm:py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold rounded-xl hover:from-emerald-700 hover:to-teal-700 shadow-md shadow-emerald-200 transition text-sm text-center active:scale-95">
                            \${confirmText}
                        </button>
                    </div>`;

const newModalStr = `                    <div class="flex flex-row justify-end gap-2 shrink-0 mt-1">
                        \${cancelText ? \`<button onclick="closeModal()" class="flex-1 sm:flex-none px-3 py-2 sm:px-4 sm:py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition text-sm text-center border border-gray-200 active:scale-95">
                            \${cancelText}
                        </button>\` : ''}
                        <button id="confirm-modal-btn" class="flex-1 sm:flex-none px-4 py-2 sm:px-5 sm:py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold rounded-xl hover:from-emerald-700 hover:to-teal-700 shadow-md shadow-emerald-200 transition text-sm text-center active:scale-95">
                            \${confirmText}
                        </button>
                    </div>`;

if (content.includes(oldModalStr)) {
    content = content.replace(oldModalStr, newModalStr);
    console.log("Patched showConfirmModal logic");
} else {
    console.log("Could not find the target code in showConfirmModal");
}

fs.writeFileSync('src/main.js', content);
