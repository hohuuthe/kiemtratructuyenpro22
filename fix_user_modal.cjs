const fs = require('fs');

let mainContent = fs.readFileSync('src/main.js', 'utf8');

const modalRegex = /window\.showUserInfoModal \= function showUserInfoModal\(\) \{[\s\S]*?showModal\(modalContent\);\s*const modalEl = document\.getElementById\('modal-content'\);\s*if \(modalEl\) \{\s*modalEl\.style\.width \= '454px';\s*modalEl\.style\.backgroundColor \= '\#ffffff';\s*\}\s*\}/;

const newModalCode = `window.showUserInfoModal = function showUserInfoModal() {
            if (!currentUser) return;
            
            const roleText = currentUser.role === 'admin' ? 'Quản trị viên' : 'Giáo viên/Học sinh';
            const audienceText = currentUser.target_audience || 'Không xác định';
            
            const modalContent = \`
                <div class="p-4 sm:p-6 md:p-8 text-center max-w-md mx-auto border rounded-2xl" style="border-color: #000000; background-color: #ffffff;">
                    <div class="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 text-white rounded-full flex items-center justify-center text-3xl sm:text-4xl md:text-5xl mx-auto mb-3 sm:mb-4 font-black shadow-[0_0_25px_rgba(52,211,153,0.5)] border-4 border-white animate-fade-in">
                        \${currentUser.full_name ? currentUser.full_name.charAt(0).toUpperCase() : '?'}
                    </div>
                    <h3 class="text-xl sm:text-2xl font-bold text-gray-800 mb-1">\${currentUser.full_name || 'Người dùng'}</h3>
                    <p class="text-gray-500 mb-4 sm:mb-6 font-medium text-sm sm:text-[18px]">@\${currentUser.username}</p>
                    
                    <div class="space-y-2 sm:space-y-3 text-left bg-gray-50 p-3 sm:p-4 md:p-5 rounded-2xl border border-gray-100 mb-4 sm:mb-6 font-semibold text-gray-800">
                        <div class="flex justify-between items-center pb-2 border-b border-gray-200/50 text-base sm:text-[20px]" style="font-weight: bold;">
                            <span class="text-gray-500 text-xs sm:text-sm">Vai trò:</span>
                            <span class="font-bold text-emerald-700">\${roleText}</span>
                        </div>
                        <div class="flex justify-between items-center pb-2 border-b border-gray-200/50 text-sm sm:text-[18px]" style="font-weight: bold;">
                            <span class="text-gray-500 text-xs sm:text-sm">Đối tượng:</span>
                            <span class="font-bold text-blue-700">\${audienceText}</span>
                        </div>
                        <div class="flex justify-between items-center pb-2 border-b border-gray-200/50 text-sm sm:text-[18px]" style="font-weight: bold;">
                            <span class="text-gray-500 text-xs sm:text-sm">Đơn vị:</span>
                            <span class="font-bold text-gray-800">\${currentUser.address || 'Chưa cập nhật'}</span>
                        </div>
                        <div class="flex justify-between items-center text-sm sm:text-[18px]" style="font-weight: bold;">
                            <span class="text-gray-500 text-xs sm:text-sm">Trạng thái:</span>
                            <span class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[10px] sm:text-xs font-bold italic">Đang hoạt động</span>
                        </div>
                    </div>
                    
                    <div class="flex flex-col gap-2 sm:gap-3">
                        <button onclick="showChangePasswordModal()" class="w-full px-3 py-2.5 sm:px-4 sm:py-3 bg-white border-2 border-emerald-500 text-emerald-600 rounded-xl hover:bg-emerald-50 transition font-bold flex items-center justify-center gap-2 text-sm sm:text-base">
                             <span>🔑</span> Đổi mật khẩu
                        </button>
                        <button onclick="showConfirmModal('Bạn có chắc chắn muốn đăng xuất?', adminLogout)" class="w-full px-3 py-2.5 sm:px-4 sm:py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition font-bold flex items-center justify-center gap-2 shadow-sm sm:shadow-lg sm:shadow-red-200 text-sm sm:text-base">
                             <span>👋</span> Đăng xuất
                        </button>
                    </div>
                </div>
            \`;
            showModal(modalContent);
            const modalEl = document.getElementById('modal-content');
            if (modalEl) {
                modalEl.style.width = '100%';
                modalEl.style.maxWidth = '454px';
                modalEl.style.backgroundColor = '#ffffff';
                modalEl.style.maxHeight = '90vh';
                modalEl.style.overflowY = 'auto';
            }
        }`;

if (mainContent.match(modalRegex)) {
    mainContent = mainContent.replace(modalRegex, newModalCode);
    fs.writeFileSync('src/main.js', mainContent);
    console.log("Successfully replaced showUserInfoModal!");
} else {
    console.log("Failed to match showUserInfoModal.");
}
