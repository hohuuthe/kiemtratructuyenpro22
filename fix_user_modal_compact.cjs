const fs = require('fs');
let mainContent = fs.readFileSync('src/main.js', 'utf8');

const oldModalRegex = /window\.showUserInfoModal \= function showUserInfoModal\(\) \{[\s\S]*?modalEl\.style\.overflowY \= 'auto';\s*\}\s*\}/;

const newModalCode = `window.showUserInfoModal = function showUserInfoModal() {
            if (!currentUser) return;
            
            const roleText = currentUser.role === 'admin' ? 'Quản trị viên' : 'Giáo viên/Học sinh';
            const audienceText = currentUser.target_audience || 'Không xác định';
            
            const modalContent = \`
                <div class="p-4 sm:p-6 text-center w-full max-w-sm mx-auto border rounded-2xl flex flex-col" style="border-color: #000000; background-color: #ffffff; max-height: 95vh;">
                    <div class="w-14 h-14 sm:w-20 sm:h-20 bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 text-white rounded-full flex items-center justify-center text-2xl sm:text-4xl mx-auto mb-2 sm:mb-4 font-black shadow-[0_0_15px_rgba(52,211,153,0.5)] border-[3px] border-white shrink-0">
                        \${currentUser.full_name ? currentUser.full_name.charAt(0).toUpperCase() : '?'}
                    </div>
                    <h3 class="text-lg sm:text-2xl font-bold text-gray-800 mb-0.5 sm:mb-1 shrink-0">\${currentUser.full_name || 'Người dùng'}</h3>
                    <p class="text-gray-500 mb-3 sm:mb-5 font-medium text-xs sm:text-[18px] shrink-0">@\${currentUser.username}</p>
                    
                    <div class="space-y-2 sm:space-y-3 text-left bg-gray-50 p-3 sm:p-5 rounded-xl sm:rounded-2xl border border-gray-100 mb-4 sm:mb-6 font-semibold text-gray-800 shrink-0">
                        <div class="flex justify-between items-center pb-1.5 sm:pb-2 border-b border-gray-200/50 text-sm sm:text-[20px]" style="font-weight: bold;">
                            <span class="text-gray-500 text-xs sm:text-sm">Vai trò:</span>
                            <span class="font-bold text-emerald-700">\${roleText}</span>
                        </div>
                        <div class="flex justify-between items-center pb-1.5 sm:pb-2 border-b border-gray-200/50 text-xs sm:text-[18px]" style="font-weight: bold;">
                            <span class="text-gray-500 text-xs sm:text-sm">Đối tượng:</span>
                            <span class="font-bold text-blue-700">\${audienceText}</span>
                        </div>
                        <div class="flex justify-between items-center pb-1.5 sm:pb-2 border-b border-gray-200/50 text-xs sm:text-[18px]" style="font-weight: bold;">
                            <span class="text-gray-500 text-xs sm:text-sm">Đơn vị:</span>
                            <span class="font-bold text-gray-800 text-right truncate pl-2">\${currentUser.address || 'Chưa cập nhật'}</span>
                        </div>
                        <div class="flex justify-between items-center text-xs sm:text-[18px]" style="font-weight: bold;">
                            <span class="text-gray-500 text-xs sm:text-sm">Trạng thái:</span>
                            <span class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[9px] sm:text-xs font-bold italic">Đang hoạt động</span>
                        </div>
                    </div>
                    
                    <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 shrink-0">
                        <button onclick="showChangePasswordModal()" class="flex-1 px-3 py-2 sm:px-4 sm:py-3 bg-white border-2 border-emerald-500 text-emerald-600 rounded-xl hover:bg-emerald-50 transition font-bold flex items-center justify-center gap-1.5 text-xs sm:text-base">
                             <span>🔑</span> Đổi MK
                        </button>
                        <button onclick="showConfirmModal('Bạn có chắc chắn muốn đăng xuất?', adminLogout)" class="flex-1 px-3 py-2 sm:px-4 sm:py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition font-bold flex items-center justify-center gap-1.5 shadow-sm sm:shadow-lg sm:shadow-red-200 text-xs sm:text-base">
                             <span>👋</span> Đăng xuất
                        </button>
                    </div>
                </div>
            \`;
            showModal(modalContent);
            const modalEl = document.getElementById('modal-content');
            if (modalEl) {
                modalEl.style.width = '100%';
                modalEl.style.maxWidth = '400px';
                modalEl.style.backgroundColor = 'transparent';
                modalEl.style.padding = '0';
            }
        }`;

if (mainContent.match(oldModalRegex)) {
    mainContent = mainContent.replace(oldModalRegex, newModalCode);
    fs.writeFileSync('src/main.js', mainContent);
    console.log("Successfully replaced showUserInfoModal with compact version!");
} else {
    console.log("Failed to match oldModalRegex.");
}
