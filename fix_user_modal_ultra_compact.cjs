const fs = require('fs');
let mainContent = fs.readFileSync('src/main.js', 'utf8');

const regex = /window\.showUserInfoModal \= function showUserInfoModal\(\) \{[\s\S]*?\}\s*\}/;

const newModalCode = `window.showUserInfoModal = function showUserInfoModal() {
            if (!currentUser) return;
            
            const roleText = currentUser.role === 'admin' ? 'Quản trị viên' : 'Giáo viên/Học sinh';
            const audienceText = currentUser.target_audience || 'Không xác định';
            
            const modalContent = \`
                <div class="px-4 py-5 sm:p-6 text-center w-full mx-auto flex flex-col">
                    <div class="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 text-white rounded-full flex items-center justify-center text-3xl sm:text-4xl mx-auto mb-2 sm:mb-3 font-black shadow-[0_0_15px_rgba(52,211,153,0.4)] border-2 border-white shrink-0">
                        \${currentUser.full_name ? currentUser.full_name.charAt(0).toUpperCase() : '?'}
                    </div>
                    <h3 class="text-xl sm:text-2xl font-bold text-gray-800 mb-0.5 shrink-0">\${currentUser.full_name || 'Người dùng'}</h3>
                    <p class="text-gray-500 mb-4 sm:mb-5 font-medium text-sm shrink-0">@\${currentUser.username}</p>
                    
                    <div class="space-y-2 text-left bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-100 mb-5 sm:mb-6 font-medium text-gray-800 shrink-0 text-sm">
                        <div class="flex justify-between items-center pb-2 border-b border-gray-200/50">
                            <span class="text-gray-500 text-xs sm:text-sm">Vai trò:</span>
                            <span class="font-bold text-emerald-700">\${roleText}</span>
                        </div>
                        <div class="flex justify-between items-center pb-2 border-b border-gray-200/50">
                            <span class="text-gray-500 text-xs sm:text-sm">Đối tượng:</span>
                            <span class="font-bold text-blue-700">\${audienceText}</span>
                        </div>
                        <div class="flex justify-between items-center pb-2 border-b border-gray-200/50">
                            <span class="text-gray-500 text-xs sm:text-sm">Đơn vị:</span>
                            <span class="font-bold text-gray-800 truncate max-w-[150px] sm:max-w-[200px] text-right">\${currentUser.address || 'Chưa cập nhật'}</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-500 text-xs sm:text-sm">Trạng thái:</span>
                            <span class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[10px] sm:text-xs font-bold italic">Hoạt động</span>
                        </div>
                    </div>
                    
                    <div class="flex gap-2 sm:gap-3 shrink-0">
                        <button onclick="showChangePasswordModal()" class="flex-1 px-3 py-2.5 sm:px-4 sm:py-3 bg-white border border-emerald-500 text-emerald-600 rounded-xl hover:bg-emerald-50 transition font-bold flex items-center justify-center gap-1.5 text-xs sm:text-sm">
                             <span>🔑</span> Đổi MK
                        </button>
                        <button onclick="showConfirmModal('Bạn có chắc chắn muốn đăng xuất?', adminLogout)" class="flex-1 px-3 py-2.5 sm:px-4 sm:py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition font-bold flex items-center justify-center gap-1.5 shadow-sm sm:shadow-md shadow-red-200 text-xs sm:text-sm">
                             <span>👋</span> Đăng xuất
                        </button>
                    </div>
                </div>
            \`;
            showModal(modalContent);
            const modalEl = document.getElementById('modal-content');
            if (modalEl) {
                modalEl.style.width = '95%';
                modalEl.style.maxWidth = '380px';
                modalEl.style.backgroundColor = '#ffffff'; // Let the modal-content handle the background
                modalEl.style.padding = '0';
                modalEl.style.overflowY = 'hidden'; // Force no scrollbar
                
                // Adjust close button position since padding is 0
                const closeBtn = modalEl.querySelector('button[title="Đóng"]');
                if (closeBtn) {
                    closeBtn.style.top = '10px';
                    closeBtn.style.right = '10px';
                }
            }
        }`;

if (mainContent.match(regex)) {
    mainContent = mainContent.replace(regex, newModalCode);
    fs.writeFileSync('src/main.js', mainContent);
    console.log("Successfully replaced showUserInfoModal with ultra compact version!");
} else {
    console.log("Failed to match regex.");
}
