// ==========================================
// PWA MANAGER FOR HỆ THỐNG KIỂM TRA TRỰC TUYẾN
// Quản lý PWA Install Prompt, Modal UI & Hướng dẫn Cài App 100%
// ==========================================

class PwaManager {
    constructor() {
        this.deferredPrompt = null;
        this.isInstalled = false;
        this.activeGuideTab = this.detectDefaultTab();
        this.isModalOpen = false;

        this.init();
    }

    detectDefaultTab() {
        if (typeof navigator === 'undefined') return 'android';
        const ua = navigator.userAgent || navigator.vendor || (window.opera ? '' : '');
        if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) {
            return 'ios';
        }
        if (/android/i.test(ua)) {
            return 'android';
        }
        return 'desktop';
    }

    init() {
        // Kiểm tra standalone mode
        this.checkInstalled();

        // Lắng nghe thay đổi display-mode
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(display-mode: standalone)');
            try {
                mediaQuery.addEventListener('change', (e) => {
                    this.isInstalled = !!e.matches;
                    this.updateUi();
                });
            } catch (err) {
                try {
                    mediaQuery.addListener((e) => {
                        this.isInstalled = !!e.matches;
                        this.updateUi();
                    });
                } catch (e2) {}
            }
        }

        // Lấy deferredPrompt đã lưu sớm trong index.html nếu có
        if (window.deferredPrompt) {
            this.deferredPrompt = window.deferredPrompt;
        }

        // Bắt sự kiện beforeinstallprompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            window.deferredPrompt = e;
            this.isInstalled = false;
            this.updateUi();
            if (this.isModalOpen) {
                this.renderModalContent();
            }
            console.log('[PWA] beforeinstallprompt captured successfully.');
        });

        // Callback nhận prompt
        window.onBeforeInstallPromptReceived = (e) => {
            this.deferredPrompt = e;
            window.deferredPrompt = e;
            this.isInstalled = false;
            this.updateUi();
            if (this.isModalOpen) {
                this.renderModalContent();
            }
        };

        // Lắng nghe appinstalled
        window.addEventListener('appinstalled', () => {
            this.isInstalled = true;
            this.deferredPrompt = null;
            window.deferredPrompt = null;
            this.updateUi();
            this.closeModal();

            if (typeof window.showToast === 'function') {
                window.showToast('🎉 Chúc mừng! Ứng dụng đã được cài đặt thành công vào thiết bị của bạn.', 'success');
            }
            console.log('[PWA] Application successfully installed.');
        });

        // Export ra window các hàm cần thiết
        window._realHandlePwaInstallClick = () => this.handleInstallClick();
        window.handlePwaInstallClick = () => this.handleInstallClick();
        window.showPwaInstallGuideModal = (tab) => this.showGuideModal(tab);
        window.switchPwaGuideTab = (tab) => this.switchTab(tab);
        window.promptPwaInstall = () => this.triggerPrompt();
        window.closePwaModal = () => this.closeModal();

        // Cập nhật UI ngay sau khi khởi tạo
        setTimeout(() => {
            this.updateUi();
        }, 100);
    }

    checkInstalled() {
        const isStandalone = 
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            (window.navigator && (window.navigator.standalone === true || window.navigator.standalone === 'true'));
        
        this.isInstalled = !!isStandalone;
    }

    updateUi() {
        this.checkInstalled();
        const btn = document.getElementById('pwa-install-btn');
        const textSpan = document.getElementById('pwa-install-btn-text');

        if (!btn) return;

        if (this.isInstalled) {
            btn.title = "Ứng dụng đã được cài đặt (Nhấn để mở bảng quản lý/hướng dẫn)";
            btn.className = "sidebar-nav-item w-full flex items-center gap-2.5 px-2.5 py-1 rounded-lg font-bold text-base text-emerald-200 hover:bg-white/10 hover:text-emerald-100 transition-all cursor-pointer";
            if (textSpan) {
                textSpan.textContent = "Đã cài App";
                textSpan.className = "truncate";
            }
        } else {
            btn.title = "Cài đặt ứng dụng lên thiết bị";
            btn.className = "sidebar-nav-item w-full flex items-center gap-2.5 px-2.5 py-1 rounded-lg font-bold text-base text-emerald-200 hover:bg-white/10 hover:text-emerald-100 transition-all cursor-pointer";
            if (textSpan) {
                textSpan.textContent = "Cài App";
                textSpan.className = "truncate";
            }
        }
    }

    handleInstallClick() {
        // Yêu cầu: Khi kích vào nút này thì PHẢI XUẤT HIỆN NGAY GIAO DIỆN CÀI APP
        this.showGuideModal();
    }

    async triggerPrompt() {
        if (this.deferredPrompt) {
            try {
                const promptEvent = this.deferredPrompt;
                promptEvent.prompt();
                const choice = await promptEvent.userChoice;
                if (choice && choice.outcome === 'accepted') {
                    if (typeof window.showToast === 'function') {
                        window.showToast('⏳ Đang tiến hành cài đặt ứng dụng...', 'info');
                    }
                    this.deferredPrompt = null;
                    window.deferredPrompt = null;
                    this.closeModal();
                } else {
                    if (typeof window.showToast === 'function') {
                        window.showToast('Bạn có thể nhấn Cài đặt bất kỳ lúc nào để hoàn tất.', 'info');
                    }
                }
            } catch (e) {
                console.warn('[PWA] Trigger prompt error:', e);
            }
        } else {
            // Trường hợp không có prompt trực tiếp (Safari/iOS hoặc máy tính chưa kích hoạt)
            const activeTab = this.activeGuideTab || this.detectDefaultTab();
            if (activeTab === 'ios') {
                if (typeof window.showToast === 'function') {
                    window.showToast('Trên iPhone/iPad: Bấm nút Chia sẻ ⬆️ và chọn "Thêm vào MH chính" ➕', 'info');
                }
            } else {
                if (typeof window.showToast === 'function') {
                    window.showToast('Vui lòng làm theo 3 bước hướng dẫn trực quan bên dưới để cài đặt nhanh!', 'info');
                }
            }
        }
    }

    switchTab(tab) {
        this.activeGuideTab = tab;
        this.renderModalContent();
    }

    ensureModalRoot() {
        let root = document.getElementById('pwa-modal-root');
        const activeFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        const targetParent = activeFs || document.body;

        if (!root) {
            root = document.createElement('div');
            root.id = 'pwa-modal-root';
            targetParent.appendChild(root);
        } else if (root.parentElement !== targetParent) {
            targetParent.appendChild(root);
        }
        return root;
    }

    showGuideModal(defaultTab) {
        if (defaultTab) {
            this.activeGuideTab = defaultTab;
        } else if (!this.activeGuideTab) {
            this.activeGuideTab = this.detectDefaultTab();
        }

        this.isModalOpen = true;
        this.renderModalContent();
    }

    closeModal() {
        this.isModalOpen = false;
        const root = document.getElementById('pwa-modal-root');
        if (root) {
            root.innerHTML = '';
        }
    }

    copyAppUrl() {
        const url = window.location.origin || window.location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                if (typeof window.showToast === 'function') {
                    window.showToast('📋 Đã sao chép liên kết ứng dụng vào bộ nhớ tạm!', 'success');
                }
            });
        }
    }

    renderModalContent() {
        if (!this.isModalOpen) return;

        const root = this.ensureModalRoot();
        const hasPrompt = !!this.deferredPrompt && !this.isInstalled;
        const isCurrentInstalled = this.isInstalled;
        const activeTab = this.activeGuideTab;
        const currentUrl = window.location.origin || window.location.href;

        // Custom QR Image data if set
        const customQrData = localStorage.getItem('custom_qr_image_data');
        const imgSrc = customQrData || ('/ma-qr.png?v=' + (window._qrTimestamp || Date.now()));

        const getTabClass = (tab) => {
            const isActive = activeTab === tab;
            if (isActive) {
                return 'bg-emerald-600 text-white shadow-md shadow-emerald-700/30 font-bold';
            }
            return 'text-gray-600 hover:text-emerald-700 hover:bg-emerald-50 font-medium';
        };

        let guideBodyHtml = '';

        if (activeTab === 'ios') {
            guideBodyHtml = `
                <div class="space-y-4 animate-fade-in">
                    <div class="p-3.5 bg-amber-50 rounded-2xl border border-amber-200/80 flex items-start gap-3">
                        <div class="text-2xl flex-shrink-0">⚠️</div>
                        <div class="text-xs md:text-sm text-amber-900 leading-relaxed">
                            <span class="font-bold">Lưu ý cho iPhone/iPad:</span> Apple hỗ trợ cài đặt ứng dụng trực tiếp qua trình duyệt <span class="font-bold text-amber-800 underline">Safari</span>. Nếu đang xem trong Zalo hoặc Facebook, hãy bấm nút ⋮ ở góc trên và chọn <strong>"Mở trong Safari"</strong>.
                        </div>
                    </div>

                    <div class="space-y-3">
                        <!-- Step 1 -->
                        <div class="flex items-start gap-3.5 p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 transition-all">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-black text-sm flex items-center justify-center flex-shrink-0">
                                1
                            </div>
                            <div class="flex-1 text-sm text-gray-700">
                                <p class="font-bold text-gray-900 mb-0.5">Bấm nút Chia sẻ (Share) trên Safari</p>
                                <p class="text-xs md:text-sm text-gray-600 leading-relaxed">
                                    Ở thanh công cụ phía dưới cùng màn hình Safari, bấm vào biểu tượng 
                                    <span class="inline-flex items-center justify-center px-2 py-0.5 bg-blue-50 text-blue-700 font-bold rounded-md border border-blue-200 text-xs mx-1">
                                        <svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg> Chia sẻ
                                    </span> 
                                    (hình vuông có mũi tên hướng lên).
                                </p>
                            </div>
                        </div>

                        <!-- Step 2 -->
                        <div class="flex items-start gap-3.5 p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 transition-all">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-black text-sm flex items-center justify-center flex-shrink-0">
                                2
                            </div>
                            <div class="flex-1 text-sm text-gray-700">
                                <p class="font-bold text-gray-900 mb-0.5">Chọn "Thêm vào MH chính" (Add to Home Screen)</p>
                                <p class="text-xs md:text-sm text-gray-600 leading-relaxed">
                                    Cuộn menu tác vụ xuống dưới và tìm mục có biểu tượng dấu cộng: 
                                    <span class="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-800 font-bold rounded-md text-xs border border-gray-200 mx-1">
                                        ➕ Thêm vào MH chính
                                    </span>
                                </p>
                            </div>
                        </div>

                        <!-- Step 3 -->
                        <div class="flex items-start gap-3.5 p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 transition-all">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-black text-sm flex items-center justify-center flex-shrink-0">
                                3
                            </div>
                            <div class="flex-1 text-sm text-gray-700">
                                <p class="font-bold text-gray-900 mb-0.5">Xác nhận "Thêm" (Add)</p>
                                <p class="text-xs md:text-sm text-gray-600 leading-relaxed">
                                    Nhấn nút <strong class="text-emerald-700">"Thêm"</strong> ở góc trên cùng bên phải. Biểu tượng ứng dụng <strong>HỆ THỐNG KIỂM TRA TRỰC TUYẾN</strong> sẽ xuất hiện ngay trên màn hình chính như một ứng dụng tải từ App Store!
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (activeTab === 'android') {
            guideBodyHtml = `
                <div class="space-y-4 animate-fade-in">
                    ${hasPrompt ? `
                    <div class="p-4 bg-gradient-to-r from-emerald-600 to-teal-700 rounded-2xl text-white shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div class="text-center sm:text-left">
                            <p class="font-bold text-base flex items-center justify-center sm:justify-start gap-2">
                                <span>⚡</span> Trình duyệt đã sẵn sàng cài đặt!
                            </p>
                            <p class="text-xs text-emerald-100 mt-0.5">Cài đặt tự động chỉ với 1 lần chạm vào nút bên cạnh.</p>
                        </div>
                        <button onclick="promptPwaInstall()" class="px-5 py-2.5 bg-white text-emerald-800 hover:bg-emerald-50 active:scale-95 font-black text-sm rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer flex-shrink-0">
                            <span>📲</span> Cài đặt ngay
                        </button>
                    </div>
                    ` : ''}

                    <div class="p-3 bg-emerald-50/80 rounded-2xl border border-emerald-200/60 text-xs md:text-sm text-emerald-900">
                        Áp dụng cho trình duyệt <strong>Google Chrome</strong>, <strong>Cốc Cốc</strong>, <strong>Samsung Internet</strong> hoặc <strong>Microsoft Edge</strong> trên Android:
                    </div>

                    <div class="space-y-3">
                        <!-- Step 1 -->
                        <div class="flex items-start gap-3.5 p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 transition-all">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-black text-sm flex items-center justify-center flex-shrink-0">
                                1
                            </div>
                            <div class="flex-1 text-sm text-gray-700">
                                <p class="font-bold text-gray-900 mb-0.5">Bấm biểu tượng Menu (3 dấu chấm)</p>
                                <p class="text-xs md:text-sm text-gray-600 leading-relaxed">
                                    Ở góc trên bên phải màn hình trình duyệt, bấm vào biểu tượng 
                                    <span class="inline-flex items-center justify-center px-2 py-0.5 bg-gray-100 text-gray-800 font-bold rounded-md border border-gray-200 text-xs mx-1">
                                        ⋮ (Menu)
                                    </span>
                                </p>
                            </div>
                        </div>

                        <!-- Step 2 -->
                        <div class="flex items-start gap-3.5 p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 transition-all">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-black text-sm flex items-center justify-center flex-shrink-0">
                                2
                            </div>
                            <div class="flex-1 text-sm text-gray-700">
                                <p class="font-bold text-gray-900 mb-0.5">Chọn "Cài đặt ứng dụng" hoặc "Thêm vào Màn hình chính"</p>
                                <p class="text-xs md:text-sm text-gray-600 leading-relaxed">
                                    Tìm và nhấn vào mục 
                                    <span class="inline-flex items-center px-2 py-0.5 bg-emerald-50 text-emerald-800 font-bold rounded-md text-xs border border-emerald-200 mx-1">
                                        📲 Cài đặt ứng dụng
                                    </span> 
                                    (hoặc "Thêm vào màn hình chính").
                                </p>
                            </div>
                        </div>

                        <!-- Step 3 -->
                        <div class="flex items-start gap-3.5 p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 transition-all">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-black text-sm flex items-center justify-center flex-shrink-0">
                                3
                            </div>
                            <div class="flex-1 text-sm text-gray-700">
                                <p class="font-bold text-gray-900 mb-0.5">Xác nhận "Cài đặt" (Install)</p>
                                <p class="text-xs md:text-sm text-gray-600 leading-relaxed">
                                    Hộp thoại xác nhận sẽ hiện ra, nhấn nút <strong>"Cài đặt"</strong>. Hệ thống sẽ tự động tạo biểu tượng ứng dụng trên màn hình điện thoại!
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (activeTab === 'desktop') {
            guideBodyHtml = `
                <div class="space-y-4 animate-fade-in">
                    ${hasPrompt ? `
                    <div class="p-4 bg-gradient-to-r from-emerald-600 to-teal-700 rounded-2xl text-white shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div class="text-center sm:text-left">
                            <p class="font-bold text-base flex items-center justify-center sm:justify-start gap-2">
                                <span>💻</span> Sẵn sàng cài đặt trên máy tính của bạn!
                            </p>
                            <p class="text-xs text-emerald-100 mt-0.5">Chạy trong cửa sổ chuyên dụng không có thanh URL, tốc độ tối ưu.</p>
                        </div>
                        <button onclick="promptPwaInstall()" class="px-5 py-2.5 bg-white text-emerald-800 hover:bg-emerald-50 active:scale-95 font-black text-sm rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer flex-shrink-0">
                            <span>📲</span> Cài đặt ngay
                        </button>
                    </div>
                    ` : ''}

                    <div class="p-3 bg-blue-50 rounded-2xl border border-blue-200/60 text-xs md:text-sm text-blue-900">
                        Áp dụng cho <strong>Google Chrome</strong>, <strong>Microsoft Edge</strong>, <strong>Brave</strong>, <strong>Cốc Cốc</strong> trên Windows, Mac hoặc Linux:
                    </div>

                    <div class="space-y-3">
                        <!-- Step 1 -->
                        <div class="flex items-start gap-3.5 p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 transition-all">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-black text-sm flex items-center justify-center flex-shrink-0">
                                1
                            </div>
                            <div class="flex-1 text-sm text-gray-700">
                                <p class="font-bold text-gray-900 mb-0.5">Cách 1: Biểu tượng Cài đặt trên thanh địa chỉ URL</p>
                                <p class="text-xs md:text-sm text-gray-600 leading-relaxed">
                                    Nhìn lên thanh nhập địa chỉ URL ở góc trên bên phải, nhấp vào biểu tượng 
                                    <span class="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-800 font-bold rounded-md text-xs border border-gray-200 mx-1">
                                        <svg class="w-3.5 h-3.5 inline mr-1 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> Cài đặt ứng dụng
                                    </span>
                                    (hình máy tính có mũi tên xuống hoặc dấu cộng).
                                </p>
                            </div>
                        </div>

                        <!-- Step 2 -->
                        <div class="flex items-start gap-3.5 p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 transition-all">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-black text-sm flex items-center justify-center flex-shrink-0">
                                2
                            </div>
                            <div class="flex-1 text-sm text-gray-700">
                                <p class="font-bold text-gray-900 mb-0.5">Cách 2: Qua Menu trình duyệt (3 chấm)</p>
                                <p class="text-xs md:text-sm text-gray-600 leading-relaxed">
                                    Nếu không thấy icon trên thanh URL: Bấm menu <strong>⋮ (3 chấm)</strong> ở góc trên bên phải > Chọn <strong>"Lưu và chia sẻ"</strong> (hoặc "Ứng dụng") > Chọn <strong>"Cài đặt trang web này dưới dạng ứng dụng..."</strong>.
                                </p>
                            </div>
                        </div>

                        <!-- Step 3 -->
                        <div class="flex items-start gap-3.5 p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 transition-all">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-black text-sm flex items-center justify-center flex-shrink-0">
                                3
                            </div>
                            <div class="flex-1 text-sm text-gray-700">
                                <p class="font-bold text-gray-900 mb-0.5">Hoàn tất cài đặt</p>
                                <p class="text-xs md:text-sm text-gray-600 leading-relaxed">
                                    Nhấn nút <strong>"Cài đặt"</strong> trong hộp thoại. Một cửa sổ làm việc độc lập sẽ mở ra ngay, có sẵn icon trên Desktop và thanh Taskbar!
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (activeTab === 'qr') {
            guideBodyHtml = `
                <div class="space-y-4 animate-fade-in text-center">
                    <div class="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 text-xs md:text-sm text-emerald-900">
                        Mở camera điện thoại (hoặc Zalo / QR Scanner) để quét mã và cài đặt trực tiếp lên điện thoại:
                    </div>

                    <div class="flex flex-col items-center justify-center p-4 bg-white rounded-3xl border border-gray-200 shadow-sm max-w-xs mx-auto">
                        <img src="${imgSrc}" alt="Mã QR Cài đặt ứng dụng" class="w-48 h-48 sm:w-56 sm:h-56 object-contain rounded-2xl border border-gray-100 shadow-sm mb-3">
                        <p class="text-xs font-semibold text-gray-600 mb-2">Quét mã để truy cập & Cài đặt App ngay</p>
                        <button onclick="window.pwaManager.copyAppUrl()" class="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl border border-emerald-200 transition flex items-center gap-1.5 active:scale-95 cursor-pointer">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                            Sao chép link web
                        </button>
                    </div>
                </div>
            `;
        } else if (activeTab === 'uninstall') {
            guideBodyHtml = `
                <div class="space-y-4 animate-fade-in">
                    <div class="p-3.5 bg-gray-50 rounded-2xl border border-gray-200 text-xs md:text-sm text-gray-700 leading-relaxed">
                        Bạn có thể dễ dàng gỡ bỏ ứng dụng bất cứ khi nào mà không làm ảnh hưởng đến dữ liệu hay trình duyệt web:
                    </div>

                    <div class="space-y-3">
                        <!-- iOS -->
                        <div class="p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm">
                            <div class="flex items-center gap-2 mb-1.5 font-bold text-gray-900 text-sm">
                                <span class="text-lg">🍏</span> Trên iPhone / iPad (iOS):
                            </div>
                            <p class="text-xs md:text-sm text-gray-600 leading-relaxed pl-6">
                                Nhấn giữ biểu tượng ứng dụng trên màn hình chính > Chọn <strong>"Xóa ứng dụng"</strong> (Delete Bookmark / App) > Xác nhận Xóa.
                            </p>
                        </div>

                        <!-- Android -->
                        <div class="p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm">
                            <div class="flex items-center gap-2 mb-1.5 font-bold text-gray-900 text-sm">
                                <span class="text-lg">🤖</span> Trên điện thoại Android:
                            </div>
                            <p class="text-xs md:text-sm text-gray-600 leading-relaxed pl-6">
                                Nhấn giữ biểu tượng ứng dụng trên màn hình chính > Chọn <strong>"Gỡ cài đặt"</strong> (biểu tượng thùng rác) > Nhấn OK để xác nhận.
                            </p>
                        </div>

                        <!-- Desktop -->
                        <div class="p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm">
                            <div class="flex items-center gap-2 mb-1.5 font-bold text-gray-900 text-sm">
                                <span class="text-lg">💻</span> Trên Máy tính (Chrome / Edge):
                            </div>
                            <p class="text-xs md:text-sm text-gray-600 leading-relaxed pl-6">
                                Mở ứng dụng > Bấm vào biểu tượng <strong>3 dấu chấm (⋮)</strong> ở góc trên bên phải thanh tiêu đề cửa sổ ứng dụng > Chọn <strong>"Gỡ cài đặt HỆ THỐNG KIỂM TRA TRỰC TUYẾN..."</strong> > Nhấn Xóa.
                            </p>
                        </div>
                    </div>
                </div>
            `;
        }

        root.innerHTML = `
            <div class="fixed inset-0 z-[9999999] flex items-center justify-center bg-black/70 backdrop-blur-md p-3 md:p-4 animate-fade-in overflow-y-auto">
                <div class="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[94vh] flex flex-col overflow-hidden relative border border-gray-100 animate-modal-enter my-auto">
                    
                    <!-- Header -->
                    <div class="bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-800 p-4 md:p-5 text-white relative flex-shrink-0 shadow-md">
                        <button onclick="closePwaModal()" class="absolute top-4 right-4 text-white/80 hover:text-white bg-black/20 hover:bg-black/40 w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer" title="Đóng">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>

                        <div class="flex items-center gap-3.5">
                            <div class="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-white/10 p-1.5 border border-white/20 backdrop-blur-md flex-shrink-0 shadow-md">
                                <img src="/pwa-192x192.png" alt="App Icon" class="w-full h-full object-contain rounded-xl" onerror="this.src='/favicon.png'">
                            </div>
                            <div class="flex-1 pr-8">
                                <h3 class="text-base md:text-lg font-black tracking-tight uppercase drop-shadow-sm">
                                    HỆ THỐNG KIỂM TRA TRỰC TUYẾN
                                </h3>
                                <div class="flex items-center gap-2 mt-0.5">
                                    <span class="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${isCurrentInstalled ? 'bg-emerald-400 text-emerald-950' : 'bg-amber-400 text-amber-950'}">
                                        ${isCurrentInstalled ? '✅ Đã cài đặt' : '✨ Sẵn sàng cài đặt'}
                                    </span>
                                    <span class="text-xs text-emerald-100/90 font-medium">
                                        Không tốn bộ nhớ
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Quick 1-Click Action Top Banner -->
                    <div class="px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 flex flex-col sm:flex-row items-center justify-between gap-2.5 flex-shrink-0">
                        <div class="text-center sm:text-left">
                            <p class="text-xs md:text-sm font-bold text-emerald-950">
                                🚀 Cài đặt để có trải nghiệm toàn màn hình mượt mà nhất
                            </p>
                            <p class="text-[11px] text-emerald-700">Mở tức thì như ứng dụng gốc, không có thanh địa chỉ rườm rà</p>
                        </div>
                        <button onclick="promptPwaInstall()" class="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-95 text-white font-black text-xs md:text-sm rounded-xl shadow-md shadow-emerald-700/20 transition-all flex items-center justify-center gap-2 cursor-pointer flex-shrink-0">
                            <span>📲</span> Cài đặt ngay
                        </button>
                    </div>

                    <!-- Navigation Tabs -->
                    <div class="p-2 md:p-3 bg-gray-50/90 border-b border-gray-100 flex-shrink-0">
                        <div class="grid grid-cols-5 gap-1 bg-gray-200/60 p-1 rounded-2xl">
                            <button onclick="switchPwaGuideTab('ios')" class="py-2 px-1 text-center rounded-xl text-xs md:text-sm transition-all flex flex-col sm:flex-row items-center justify-center gap-1 cursor-pointer ${getTabClass('ios')}">
                                <span>🍏</span> <span>iOS</span>
                            </button>
                            <button onclick="switchPwaGuideTab('android')" class="py-2 px-1 text-center rounded-xl text-xs md:text-sm transition-all flex flex-col sm:flex-row items-center justify-center gap-1 cursor-pointer ${getTabClass('android')}">
                                <span>🤖</span> <span>Android</span>
                            </button>
                            <button onclick="switchPwaGuideTab('desktop')" class="py-2 px-1 text-center rounded-xl text-xs md:text-sm transition-all flex flex-col sm:flex-row items-center justify-center gap-1 cursor-pointer ${getTabClass('desktop')}">
                                <span>💻</span> <span>PC / Mac</span>
                            </button>
                            <button onclick="switchPwaGuideTab('qr')" class="py-2 px-1 text-center rounded-xl text-xs md:text-sm transition-all flex flex-col sm:flex-row items-center justify-center gap-1 cursor-pointer ${getTabClass('qr')}">
                                <span>📱</span> <span>Mã QR</span>
                            </button>
                            <button onclick="switchPwaGuideTab('uninstall')" class="py-2 px-1 text-center rounded-xl text-xs md:text-sm transition-all flex flex-col sm:flex-row items-center justify-center gap-1 cursor-pointer ${getTabClass('uninstall')}">
                                <span>🗑️</span> <span>Gỡ cài</span>
                            </button>
                        </div>
                    </div>

                    <!-- Body Content -->
                    <div class="p-4 md:p-5 overflow-y-auto flex-1 custom-scrollbar">
                        ${guideBodyHtml}

                        <!-- Benefits Box -->
                        <div class="mt-5 pt-4 border-t border-gray-100 grid grid-cols-3 gap-2 text-center text-[11px] md:text-xs text-gray-600">
                            <div class="p-2 bg-emerald-50/60 rounded-xl border border-emerald-100">
                                <span class="text-base block mb-0.5">⚡</span>
                                <span class="font-bold text-gray-800">Tốc độ tức thì</span>
                            </div>
                            <div class="p-2 bg-emerald-50/60 rounded-xl border border-emerald-100">
                                <span class="text-base block mb-0.5">📱</span>
                                <span class="font-bold text-gray-800">Toàn màn hình</span>
                            </div>
                            <div class="p-2 bg-emerald-50/60 rounded-xl border border-emerald-100">
                                <span class="text-base block mb-0.5">🔒</span>
                                <span class="font-bold text-gray-800">Bảo mật cao</span>
                            </div>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div class="p-3.5 md:p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
                        <span class="text-xs text-gray-500 hidden sm:inline">PWA v1.0 • Chuẩn quốc tế Progressive Web App</span>
                        <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
                            <button onclick="window.pwaManager.copyAppUrl()" class="px-3.5 py-2 bg-white hover:bg-gray-100 text-gray-700 font-semibold text-xs md:text-sm rounded-xl border border-gray-200 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer">
                                📋 Sao chép link
                            </button>
                            <button onclick="closePwaModal()" class="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold text-xs md:text-sm rounded-xl transition-all active:scale-95 cursor-pointer">
                                Đóng
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        `;
    }
}

// Khởi tạo Singleton PwaManager ngay khi script được load
let pwaManagerInstance = null;
if (typeof window !== 'undefined') {
    pwaManagerInstance = new PwaManager();
    window.pwaManager = pwaManagerInstance;
}

export default pwaManagerInstance;
