const fs = require('fs');
let mainContent = fs.readFileSync('src/main.js', 'utf8');

const regex = /function showConfirmModal\(message, onConfirm, title \= '⚠️ Xác nhận', confirmText \= 'Xác nhận', cancelText \= 'Hủy'\) \{[\s\S]*?if \(btn\) \{\s*btn\.addEventListener\('click', \(\) \=\> \{/;

const newConfirmModal = `function showConfirmModal(message, onConfirm, title = '⚠️ Xác nhận', confirmText = 'Xác nhận', cancelText = 'Hủy') {
            const modalContent = \`
                <div class="p-4 sm:p-5 w-full max-w-sm mx-auto flex flex-col">
                    <h3 class="text-base sm:text-lg font-bold text-gray-800 mb-2 flex items-center gap-2 border-b border-gray-100 pb-2 shrink-0">
                        \${title}
                    </h3>
                    <div class="text-gray-600 mb-4 text-sm sm:text-base leading-snug overflow-x-hidden shrink-0">
                        \${message}
                    </div>
                    <div class="flex flex-row justify-end gap-2 shrink-0 mt-1">
                        <button onclick="closeModal()" class="flex-1 sm:flex-none px-3 py-2 sm:px-4 sm:py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition text-sm text-center border border-gray-200 active:scale-95">
                            \${cancelText}
                        </button>
                        <button id="confirm-modal-btn" class="flex-1 sm:flex-none px-4 py-2 sm:px-5 sm:py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold rounded-xl hover:from-emerald-700 hover:to-teal-700 shadow-md shadow-emerald-200 transition text-sm text-center active:scale-95">
                            \${confirmText}
                        </button>
                    </div>
                </div>
            \`;
            showModal(modalContent);
            
            const modalEl = document.getElementById('modal-content');
            if (modalEl) {
                modalEl.style.width = '90%';
                modalEl.style.maxWidth = '360px';
                modalEl.style.overflowY = 'hidden'; // Ensure no scrollbar
                
                // Adjust close button position
                const closeBtn = modalEl.querySelector('button[title="Đóng"]');
                if (closeBtn) {
                    closeBtn.style.top = '8px';
                    closeBtn.style.right = '8px';
                }
            }
            const btn = document.getElementById('confirm-modal-btn');
            if (btn) {
                btn.addEventListener('click', () => {`;

if (mainContent.match(regex)) {
    mainContent = mainContent.replace(regex, newConfirmModal);
    fs.writeFileSync('src/main.js', mainContent);
    console.log("Successfully replaced showConfirmModal with ultra compact version!");
} else {
    console.log("Failed to match regex for showConfirmModal.");
}
