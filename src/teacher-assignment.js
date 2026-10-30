/**
 * ỨNG DỤNG PHÂN CÔNG GIÁO VIÊN
 * Chuyên trang quản lý phân công 2 chiều: Lớp cho Giáo viên & Giáo viên cho Lớp học
 * Tích hợp chặt chẽ vào HỆ THỐNG KIỂM TRA TRỰC TUYẾN
 */

(function () {
  // Trạng thái ứng dụng Phân công giáo viên
  window.taState = {
    teachers: [],          // Danh sách giáo viên: [{ id, username, full_name, donvi, phone_number, ... }]
    classes: [],           // Danh sách lớp học: string[] (VD: ['10A1', '10A2', '11A1', '12A1'])
    assignments: [],       // Danh sách phân công từ DB: [{ id, teacher_id, teacher_name, class_name, donvi, role, subject }]
    schoolClasses: [],     // Danh sách lớp theo đơn vị
    currentView: 'teachers', // 'teachers' | 'classes' | 'matrix'
    filterDonvi: '',
    filterGrade: '',       // '', '12', '11', '10', 'other'
    filterRole: '',        // '', 'has_classes', 'no_classes', 'chu_nhiem', 'bo_mon'
    searchQuery: '',
    currentEditTeacher: null, // Giáo viên đang được chọn phân công
    currentEditClass: null,   // Lớp đang được chọn phân công
    modalTeacherClasses: [],  // Tạm thời trong modal phân công GV: [{ class_name, role, subject, checked }]
    modalClassTeachers: [],   // Tạm thời trong modal phân công Lớp: [{ teacher_id, teacher_name, role, subject, checked }]
    modalClassHomeroomTeacherId: '', // GVCN trong modal phân công Lớp
    excelImportData: [],      // Dữ liệu đọc từ file Excel
    isLoading: false
  };

  const escapeHTML = (str) => {
    if (typeof window.escapeHTML === 'function') return window.escapeHTML(str);
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const getAuthToken = () => {
    return localStorage.getItem(window.tenantStorageKey ? window.tenantStorageKey('auth_token') : 'auth_token') || '';
  };

  /**
   * Khởi tạo hoặc tải lại toàn bộ dữ liệu phân công
   */
  window.initTeacherAssignmentApp = async function (forceReload = false) {
    const container = document.getElementById('tab-teacher-assignment');
    if (!container) return;

    window.taState.isLoading = true;
    updateStatSummaryPlaceholder();

    try {
      const token = getAuthToken();

      // BẢO MẬT & VAI TRÒ: Chỉ Admin mới có quyền truy cập
      const isAdmin = Boolean(window.isAdminLoggedIn);
      const isTeacher = Boolean(window.isTeacherLoggedIn) && !isAdmin;
      if (!isAdmin) {
        container.innerHTML = `
          <div class="bg-red-50 border-2 border-red-300 rounded-2xl p-6 text-center text-red-700 shadow-md my-8 max-w-lg mx-auto">
            <div class="text-4xl mb-2">🔒</div>
            <h3 class="text-lg font-bold mb-1">TRUY CẬP BỊ TỪ CHỐI</h3>
            <p class="text-sm text-red-600">Chức năng Phân công giáo viên chỉ dành riêng cho tài khoản Quản trị viên (Admin).</p>
          </div>
        `;
        return;
      }

      // 1. Tải danh sách giáo viên (từ window.usersList hoặc gọi API /api/users)
      let teachersList = [];
      if (!window.usersList || window.usersList.length === 0 || forceReload) {
        try {
          const uRes = await fetch('/api/users', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          if (uRes.ok) {
            const uData = await uRes.json();
            if (Array.isArray(uData.data)) {
              window.usersList = uData.data;
            }
          }
        } catch (e) {
          console.warn('Lỗi khi tải users cho phân công:', e);
        }
      }

      const allUsers = window.usersList || [];
      teachersList = allUsers.filter(u => {
        const aud = String(u.target_audience || '').toLowerCase();
        const accRole = String(u.account_role || u.role || '').toLowerCase();
        return aud === 'giáo viên' || aud === 'admin' || accRole === 'teacher' || accRole === 'admin';
      });

      // Nếu không có ai trong users là giáo viên, kiểm tra accountsList
      if (teachersList.length === 0 && Array.isArray(window.accountsList)) {
        teachersList = window.accountsList.filter(a => a.role === 'teacher' || a.role === 'admin').map(a => ({
          id: a.user_id || a.id,
          username: a.username,
          full_name: a.full_name || a.username,
          donvi: a.donvi || '',
          account_role: a.role,
          target_audience: 'Giáo viên'
        }));
      }

      // 2. Tải toàn bộ phân công lớp và danh sách lớp học từ /api/teacher-classes?view_all=true
      const tcRes = await fetch('/api/teacher-classes?view_all=true', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const tcData = await tcRes.json().catch(() => ({}));
      const assignments = (tcData && Array.isArray(tcData.data)) ? tcData.data : [];
      window.taState.assignments = assignments;

      // Bổ sung giáo viên từ danh sách phân công (assignments) nếu chưa có trong teachersList
      assignments.forEach(a => {
        if (a.teacher_id && !teachersList.some(t => String(t.id) === String(a.teacher_id))) {
          teachersList.push({
            id: a.teacher_id,
            username: a.teacher_id,
            full_name: a.teacher_name || a.teacher_id,
            donvi: a.donvi || '',
            account_role: 'teacher',
            target_audience: 'Giáo viên'
          });
        }
      });

      window.taState.teachers = teachersList;

      // 3. Xây dựng danh sách toàn bộ Lớp học trong trường
      const classSet = new Set();
      if (tcData && Array.isArray(tcData.school_classes)) {
        tcData.school_classes.forEach(c => {
          if (c && String(c).trim()) classSet.add(String(c).trim());
        });
      }
      allUsers.forEach(u => {
        if (u.lop && String(u.lop).trim()) classSet.add(String(u.lop).trim());
      });
      assignments.forEach(a => {
        if (a.class_name && String(a.class_name).trim()) classSet.add(String(a.class_name).trim());
      });
      if (window.appSettings && Array.isArray(window.appSettings.class_names)) {
        window.appSettings.class_names.forEach(c => {
          if (c && String(c).trim()) classSet.add(String(c).trim());
        });
      }

      window.taState.classes = Array.from(classSet).sort((a, b) =>
        a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' })
      );

      // 4. Đồng bộ assigned_classes vào từng user trong window.taState.teachers
      window.taState.teachers.forEach(t => {
        const teacherAssigned = assignments.filter(a => String(a.teacher_id) === String(t.id));
        t.assigned_classes = teacherAssigned.map(a => ({
          class_name: a.class_name,
          role: a.role || 'bo_mon',
          subject: a.subject || ''
        }));
      });

      const noticeBanner = document.getElementById('ta-teacher-notice-banner');
      const btnAddClass = document.getElementById('ta-btn-add-class');
      const btnImportExcel = document.getElementById('ta-btn-import-excel');

      if (isTeacher) {
        if (noticeBanner) noticeBanner.classList.remove('hidden');
        if (btnAddClass) btnAddClass.classList.add('hidden');
        if (btnImportExcel) btnImportExcel.classList.add('hidden');

        // Lấy thông tin giáo viên đăng nhập
        const myId = (window.currentUser && (window.currentUser.id || window.currentUser.user_id)) || '';
        const myUsername = (window.currentUser && window.currentUser.username) || '';
        
        let myTeacherObj = window.taState.teachers.find(t =>
          (myId && String(t.id) === String(myId)) ||
          (myUsername && t.username === myUsername)
        );

        if (!myTeacherObj && window.currentUser) {
          myTeacherObj = {
            id: myId || myUsername || 'my_id',
            username: myUsername,
            full_name: window.currentUser.full_name || window.currentUser.ho_ten || myUsername || 'Giáo viên',
            donvi: window.currentUser.donvi || (assignments[0]?.donvi) || '',
            account_role: 'teacher',
            target_audience: 'Giáo viên',
            assigned_classes: assignments.map(a => ({
              class_name: a.class_name,
              role: a.role || 'bo_mon',
              subject: a.subject || ''
            }))
          };
        } else if (myTeacherObj) {
          myTeacherObj.assigned_classes = assignments.map(a => ({
            class_name: a.class_name,
            role: a.role || 'bo_mon',
            subject: a.subject || ''
          }));
        }

        if (myTeacherObj) {
          window.taState.teachers = [myTeacherObj];
        }

        // Khôi phục bộ lọc để không lỡ tay lọc mất giáo viên
        window.taState.filterDonvi = '';
        window.taState.filterRole = '';

        // Danh sách lớp học chỉ còn các lớp được phân công
        const myAssignedClasses = assignments.map(a => a.class_name).filter(Boolean);
        window.taState.classes = Array.from(new Set(myAssignedClasses)).sort((a, b) =>
          a.localeCompare(b, 'vi', { numeric: true })
        );
      } else {
        if (noticeBanner) noticeBanner.classList.add('hidden');
        if (btnAddClass) btnAddClass.classList.remove('hidden');
        if (btnImportExcel) btnImportExcel.classList.remove('hidden');
      }

      // 5. Cập nhật dropdown đơn vị
      populateDonviFilter();

      // 6. Cập nhật thống kê & Render View hiện tại
      updateStatSummary();
      window.taRenderCurrentView();

    } catch (err) {
      console.error('Lỗi khi tải dữ liệu phân công giáo viên:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Không thể tải dữ liệu phân công: ' + (err.message || 'Lỗi mạng'), 'error');
      }
    } finally {
      window.taState.isLoading = false;
    }
  };

  /**
   * Cập nhật danh sách đơn vị vào dropdown bộ lọc
   */
  function populateDonviFilter() {
    const sel = document.getElementById('ta-filter-donvi');
    if (!sel) return;

    const donviSet = new Set();
    window.taState.teachers.forEach(t => {
      if (t.donvi && t.donvi.trim()) donviSet.add(t.donvi.trim());
    });
    window.taState.assignments.forEach(a => {
      if (a.donvi && a.donvi.trim()) donviSet.add(a.donvi.trim());
    });

    const currentVal = sel.value;
    sel.innerHTML = '<option value="">Tất cả đơn vị / trường</option>';
    Array.from(donviSet).sort((a, b) => a.localeCompare(b, 'vi')).forEach(dv => {
      const opt = document.createElement('option');
      opt.value = dv;
      opt.textContent = dv;
      if (dv === currentVal) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  /**
   * Cập nhật số liệu thống kê tổng quan (KPI cards)
   */
  function updateStatSummaryPlaceholder() {
    const ids = ['ta-stat-total-teachers', 'ta-stat-total-classes', 'ta-stat-classes-with-cn', 'ta-stat-total-assignments'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '...';
    });
  }

  function updateStatSummary() {
    const teachers = window.taState.teachers || [];
    const classes = window.taState.classes || [];
    const assignments = window.taState.assignments || [];

    const assignedTeachersCount = teachers.filter(t => (t.assigned_classes && t.assigned_classes.length > 0)).length;
    const homeroomClassesSet = new Set(
      assignments.filter(a => a.role === 'chu_nhiem').map(a => a.class_name.toLowerCase())
    );
    const classesWithCnCount = homeroomClassesSet.size;
    const classesNoCnCount = Math.max(0, classes.length - classesWithCnCount);

    const elTotalTeachers = document.getElementById('ta-stat-total-teachers');
    const elAssignedTeachers = document.getElementById('ta-stat-assigned-teachers');
    const elTotalClasses = document.getElementById('ta-stat-total-classes');
    const elClassesWithCn = document.getElementById('ta-stat-classes-with-cn');
    const elClassesNoCn = document.getElementById('ta-stat-classes-no-cn');
    const elTotalAssignments = document.getElementById('ta-stat-total-assignments');

    if (elTotalTeachers) elTotalTeachers.textContent = teachers.length;
    if (elAssignedTeachers) elAssignedTeachers.textContent = `(${assignedTeachersCount} đã phân)`;
    if (elTotalClasses) elTotalClasses.textContent = classes.length;
    if (elClassesWithCn) elClassesWithCn.textContent = classesWithCnCount;
    if (elClassesNoCn) elClassesNoCn.textContent = `(${classesNoCnCount} chưa có)`;
    if (elTotalAssignments) elTotalAssignments.textContent = assignments.length;
  }

  /**
   * Chuyển đổi giữa 3 chế độ xem (Theo Giáo viên / Theo Lớp / Ma trận)
   */
  window.taSwitchView = function (viewName) {
    window.taState.currentView = viewName;

    // Cập nhật giao diện nút bấm
    const btnTeachers = document.getElementById('ta-btn-view-teachers');
    const btnClasses = document.getElementById('ta-btn-view-classes');
    const btnMatrix = document.getElementById('ta-btn-view-matrix');

    const vTeachers = document.getElementById('ta-view-teachers');
    const vClasses = document.getElementById('ta-view-classes');
    const vMatrix = document.getElementById('ta-view-matrix');

    [btnTeachers, btnClasses, btnMatrix].forEach(b => {
      if (!b) return;
      b.className = 'px-2.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-gray-600 hover:text-gray-900 transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap';
    });

    [vTeachers, vClasses, vMatrix].forEach(v => {
      if (v) v.classList.add('hidden');
    });

    if (viewName === 'teachers') {
      if (btnTeachers) btnTeachers.className = 'px-2.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-1 sm:gap-1.5 shadow-xs cursor-pointer bg-indigo-600 text-white whitespace-nowrap';
      if (vTeachers) vTeachers.classList.remove('hidden');
    } else if (viewName === 'classes') {
      if (btnClasses) btnClasses.className = 'px-2.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-1 sm:gap-1.5 shadow-xs cursor-pointer bg-indigo-600 text-white whitespace-nowrap';
      if (vClasses) vClasses.classList.remove('hidden');
    } else if (viewName === 'matrix') {
      if (btnMatrix) btnMatrix.className = 'px-2.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-1 sm:gap-1.5 shadow-xs cursor-pointer bg-indigo-600 text-white whitespace-nowrap';
      if (vMatrix) vMatrix.classList.remove('hidden');
    }

    window.taRenderCurrentView();
  };

  /**
   * Xử lý bộ lọc thay đổi
   */
  window.taOnFilterChange = function () {
    const selDonvi = document.getElementById('ta-filter-donvi');
    const selRole = document.getElementById('ta-filter-role');
    const inpSearch = document.getElementById('ta-search-input');
    const clearBtn = document.getElementById('ta-search-clear');

    if (selDonvi) window.taState.filterDonvi = selDonvi.value.trim().toLowerCase();
    if (selRole) window.taState.filterRole = selRole.value.trim();
    if (inpSearch) {
      window.taState.searchQuery = inpSearch.value.trim().toLowerCase();
      if (clearBtn) {
        if (inpSearch.value.trim()) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
      }
    }

    window.taRenderCurrentView();
  };

  /**
   * Thiết lập bộ lọc theo Khối
   */
  window.taSetGradeFilter = function (grade) {
    window.taState.filterGrade = grade;
    document.querySelectorAll('.ta-grade-chip').forEach(chip => {
      const g = chip.getAttribute('data-grade');
      if (g === grade) {
        chip.className = 'ta-grade-chip px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer bg-indigo-600 text-white shadow-xs';
      } else {
        chip.className = 'ta-grade-chip px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer bg-gray-100 text-gray-700 hover:bg-gray-200';
      }
    });
    window.taRenderCurrentView();
  };

  /**
   * Kiểm tra một lớp có khớp với bộ lọc khối hay không
   */
  function matchGrade(className, gradeFilter) {
    if (!gradeFilter) return true;
    const name = String(className || '').trim().toLowerCase();
    if (gradeFilter === '12') return name.startsWith('12') || name.includes('khối 12') || name.includes('k12');
    if (gradeFilter === '11') return name.startsWith('11') || name.includes('khối 11') || name.includes('k11');
    if (gradeFilter === '10') return name.startsWith('10') || name.includes('khối 10') || name.includes('k10');
    if (gradeFilter === 'other') {
      return !name.startsWith('12') && !name.startsWith('11') && !name.startsWith('10');
    }
    return true;
  }

  /**
   * Render view tương ứng với state hiện tại
   */
  window.taRenderCurrentView = function () {
    if (window.taState.currentView === 'teachers') {
      renderTeachersView();
    } else if (window.taState.currentView === 'classes') {
      renderClassesView();
    } else if (window.taState.currentView === 'matrix') {
      renderMatrixView();
    }
  };

  // ==========================================
  // VIEW 1: PHÂN CÔNG THEO GIÁO VIÊN
  // ==========================================
  function renderTeachersView() {
    const container = document.getElementById('ta-teachers-list');
    if (!container) return;

    let teachers = window.taState.teachers || [];
    const query = window.taState.searchQuery;
    const filterDonvi = window.taState.filterDonvi;
    const filterGrade = window.taState.filterGrade;
    const filterRole = window.taState.filterRole;

    // Lọc danh sách
    teachers = teachers.filter(t => {
      // 1. Đơn vị
      if (filterDonvi && String(t.donvi || '').toLowerCase() !== filterDonvi) return false;

      const assigned = t.assigned_classes || [];

      // 2. Lọc theo khối: GV phải có ít nhất 1 lớp khớp khối (nếu có lớp)
      if (filterGrade) {
        if (assigned.length === 0) return false;
        const hasGrade = assigned.some(c => matchGrade(c.class_name, filterGrade));
        if (!hasGrade) return false;
      }

      // 3. Lọc theo vai trò
      if (filterRole === 'has_classes' && assigned.length === 0) return false;
      if (filterRole === 'no_classes' && assigned.length > 0) return false;
      if (filterRole === 'chu_nhiem' && !assigned.some(c => c.role === 'chu_nhiem')) return false;
      if (filterRole === 'bo_mon' && !assigned.some(c => c.role === 'bo_mon')) return false;

      // 4. Tìm kiếm từ khóa
      if (query) {
        const nameMatch = String(t.full_name || '').toLowerCase().includes(query);
        const userMatch = String(t.username || '').toLowerCase().includes(query);
        const donviMatch = String(t.donvi || '').toLowerCase().includes(query);
        const classMatch = assigned.some(c =>
          String(c.class_name || '').toLowerCase().includes(query) ||
          String(c.subject || '').toLowerCase().includes(query)
        );
        if (!nameMatch && !userMatch && !donviMatch && !classMatch) return false;
      }

      return true;
    });

    if (teachers.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 px-4 text-center bg-gray-50 border border-dashed border-gray-200 rounded-3xl">
          <span class="text-3xl">🔍</span>
          <p class="font-bold text-gray-700 text-sm mt-2">Không tìm thấy giáo viên nào phù hợp</p>
          <p class="text-xs text-gray-500 mt-1">Hãy thử xóa từ khóa tìm kiếm hoặc chọn lại bộ lọc khối / vai trò.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = teachers.map(t => {
      const assigned = t.assigned_classes || [];
      const homeroomClasses = assigned.filter(c => c.role === 'chu_nhiem');
      const subjectClasses = assigned.filter(c => c.role === 'bo_mon');
      const initial = (t.full_name ? t.full_name.trim().charAt(0) : 'G').toUpperCase();

      return `
        <div class="bg-white rounded-3xl p-4 sm:p-5 border border-gray-200/90 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden">
          <div class="space-y-3">
            <!-- Header card: Avatar + Info -->
            <div class="flex items-start justify-between gap-2.5">
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white font-black text-base sm:text-lg flex items-center justify-center shrink-0 shadow-xs">
                  ${escapeHTML(initial)}
                </div>
                <div class="min-w-0 flex-1">
                  <h4 class="font-bold text-sm sm:text-base text-gray-900 truncate" title="${escapeHTML(t.full_name || t.username)}">
                    ${escapeHTML(t.full_name || t.username)}
                  </h4>
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <span class="text-xs font-medium text-gray-500 truncate" title="${escapeHTML(t.donvi || '')}">
                      🏫 ${escapeHTML(t.donvi || 'Toàn trường')}
                    </span>
                  </div>
                </div>
              </div>
              <span class="px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap shrink-0 ${assigned.length > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
                ${assigned.length > 0 ? `${assigned.length} lớp` : 'Chưa phân'}
              </span>
            </div>

            <!-- Contact & Role pills -->
            <div class="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 pt-2 border-t border-gray-100">
              ${t.username ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 rounded-lg font-mono text-[11px] whitespace-nowrap">👤 ${escapeHTML(t.username)}</span>` : ''}
              ${t.phone_number ? `<a href="tel:${escapeHTML(t.phone_number)}" class="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-semibold text-[11px] whitespace-nowrap transition">📞 ${escapeHTML(t.phone_number)}</a>` : ''}
            </div>

            <!-- Assigned Classes Section -->
            <div class="space-y-2 pt-1">
              <!-- Homeroom (GVCN) -->
              ${homeroomClasses.length > 0 ? `
                <div class="bg-amber-50/80 p-2.5 rounded-2xl border border-amber-200/80">
                  <div class="text-[11px] font-black text-amber-900 flex items-center gap-1 mb-1.5 whitespace-nowrap">
                    <span>👑 CHỦ NHIỆM (${homeroomClasses.length}):</span>
                  </div>
                  <div class="flex flex-wrap gap-1.5">
                    ${homeroomClasses.map(c => `
                      <span class="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-amber-900 border border-amber-300 rounded-xl text-xs font-black shadow-2xs whitespace-nowrap">
                        <span>${escapeHTML(c.class_name)}</span>
                        ${c.subject ? `<span class="text-[11px] text-amber-700 font-semibold">(${escapeHTML(c.subject)})</span>` : ''}
                      </span>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              <!-- Subjects (GVBM) -->
              <div>
                <div class="text-[11px] font-bold text-gray-700 flex items-center justify-between mb-1.5">
                  <span class="flex items-center gap-1 whitespace-nowrap">
                    <span>📖 Bộ môn:</span>
                  </span>
                  <span class="text-[11px] text-gray-500 font-semibold whitespace-nowrap">${subjectClasses.length} lớp</span>
                </div>
                ${subjectClasses.length > 0 ? `
                  <div class="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                    ${subjectClasses.map(c => `
                      <span class="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-900 border border-indigo-200 rounded-xl text-xs font-bold whitespace-nowrap" title="${escapeHTML(c.subject ? 'Môn: ' + c.subject : '')}">
                        <span>${escapeHTML(c.class_name)}</span>
                        ${c.subject ? `<span class="text-[11px] text-indigo-600 font-semibold">(${escapeHTML(c.subject)})</span>` : ''}
                      </span>
                    `).join('')}
                  </div>
                ` : `
                  <p class="text-xs text-gray-400 italic">Chưa phụ trách môn lớp nào</p>
                `}
              </div>
            </div>
          </div>

          <!-- Card Actions -->
          <div class="mt-3.5 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
            <button type="button" onclick="window.taOpenAssignTeacherModal('${t.id}')" class="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap">
              <span>⚡</span>
              <span>Phân công lớp</span>
            </button>
            ${assigned.length > 0 ? `
              <button type="button" onclick="window.taDeleteAllClassesForTeacher('${t.id}', '${escapeHTML(t.full_name)}')" class="py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 transition-all cursor-pointer whitespace-nowrap shrink-0" title="Gỡ toàn bộ phân công của giáo viên này">
                🗑️
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // ==========================================
  // VIEW 2: PHÂN CÔNG THEO LỚP HỌC
  // ==========================================
  function renderClassesView() {
    const container = document.getElementById('ta-classes-list');
    if (!container) return;

    let classes = window.taState.classes || [];
    const assignments = window.taState.assignments || [];
    const teachers = window.taState.teachers || [];
    const query = window.taState.searchQuery;
    const filterDonvi = window.taState.filterDonvi;
    const filterGrade = window.taState.filterGrade;
    const filterRole = window.taState.filterRole;

    // Lọc danh sách lớp
    classes = classes.filter(className => {
      // 1. Khối
      if (filterGrade && !matchGrade(className, filterGrade)) return false;

      // Lấy danh sách phân công của lớp này
      const classAssignments = assignments.filter(a =>
        a.class_name.toLowerCase() === className.toLowerCase()
      );

      // 2. Đơn vị: nếu có lọc đơn vị, lớp phải có GV thuộc đơn vị đó hoặc tìm từ students
      if (filterDonvi) {
        const matchDonvi = classAssignments.some(a => String(a.donvi || '').toLowerCase() === filterDonvi);
        if (!matchDonvi) return false;
      }

      // 3. Vai trò
      const hasHomeroom = classAssignments.some(a => a.role === 'chu_nhiem');
      if (filterRole === 'chu_nhiem' && !hasHomeroom) return false;
      if (filterRole === 'no_classes' && hasHomeroom) return false;
      if (filterRole === 'has_classes' && classAssignments.length === 0) return false;

      // 4. Tìm kiếm
      if (query) {
        const classMatch = className.toLowerCase().includes(query);
        const teacherMatch = classAssignments.some(a =>
          String(a.teacher_name || '').toLowerCase().includes(query) ||
          String(a.subject || '').toLowerCase().includes(query)
        );
        if (!classMatch && !teacherMatch) return false;
      }

      return true;
    });

    if (classes.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 px-4 text-center bg-gray-50 border border-dashed border-gray-200 rounded-3xl">
          <span class="text-3xl">🏫</span>
          <p class="font-bold text-gray-700 text-sm mt-2">Không tìm thấy lớp học nào phù hợp</p>
          <p class="text-xs text-gray-500 mt-1">Bạn có thể bấm nút <strong>"+ Thêm lớp học"</strong> phía trên để bổ sung lớp mới.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = classes.map(className => {
      const classAssignments = assignments.filter(a =>
        a.class_name.toLowerCase() === className.toLowerCase()
      );
      const homeroom = classAssignments.find(a => a.role === 'chu_nhiem');
      const subjectTeachers = classAssignments.filter(a => a.role === 'bo_mon');

      // Đếm số học sinh trong lớp nếu có
      const studentCount = (window.usersList || []).filter(u =>
        String(u.lop || '').trim().toLowerCase() === className.toLowerCase()
      ).length;

      return `
        <div class="bg-white rounded-3xl p-4 sm:p-5 border border-gray-200/90 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
          <div class="space-y-3">
            <!-- Header: Class Name + Badge -->
            <div class="flex items-start justify-between gap-2.5">
              <div class="flex items-center gap-2.5 min-w-0 flex-1">
                <span class="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-700 border border-amber-300/40 flex items-center justify-center font-black text-sm shrink-0">
                  🏫
                </span>
                <div class="min-w-0 flex-1">
                  <h4 class="font-black text-base sm:text-lg text-gray-900 tracking-tight truncate">
                    Lớp ${escapeHTML(className)}
                  </h4>
                  <span class="text-xs text-gray-500 font-medium whitespace-nowrap block truncate">
                    ${studentCount > 0 ? `👥 ${studentCount} học sinh` : 'Chưa có học sinh'}
                  </span>
                </div>
              </div>
              <span class="px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap shrink-0 ${homeroom ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
                ${homeroom ? 'Đã có GVCN' : 'Thiếu GVCN'}
              </span>
            </div>

            <!-- Homeroom Teacher (GVCN) Box -->
            <div class="p-2.5 rounded-2xl border ${homeroom ? 'bg-amber-50/80 border-amber-200' : 'bg-gray-50 border-dashed border-gray-200'}">
              <div class="text-[11px] font-black text-amber-900 flex items-center justify-between mb-1 whitespace-nowrap">
                <span class="flex items-center gap-1">👑 CHỦ NHIỆM:</span>
              </div>
              ${homeroom ? `
                <div class="flex items-center justify-between gap-2">
                  <span class="font-bold text-xs sm:text-sm text-gray-900 truncate">
                    ${escapeHTML(homeroom.teacher_name || 'Giáo viên')}
                  </span>
                  ${homeroom.subject ? `<span class="text-[11px] text-amber-800 font-semibold bg-amber-100/90 px-2 py-0.5 rounded-lg shrink-0 whitespace-nowrap">${escapeHTML(homeroom.subject)}</span>` : ''}
                </div>
              ` : `
                <div class="text-xs text-rose-600 font-medium flex items-center gap-1 whitespace-nowrap">
                  <span>Chưa phân công GV Chủ nhiệm</span>
                </div>
              `}
            </div>

            <!-- Subject Teachers List -->
            <div>
              <div class="text-[11px] font-bold text-gray-700 flex items-center justify-between mb-1.5">
                <span class="whitespace-nowrap">📚 Giáo viên bộ môn:</span>
                <span class="text-[11px] text-gray-500 font-semibold whitespace-nowrap">${subjectTeachers.length} GV</span>
              </div>
              ${subjectTeachers.length > 0 ? `
                <div class="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  ${subjectTeachers.map(st => `
                    <div class="flex items-center justify-between gap-2 text-xs p-2 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-100 transition">
                      <span class="font-bold text-gray-800 truncate">
                        ${escapeHTML(st.teacher_name || 'GV')}
                      </span>
                      <span class="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg shrink-0 whitespace-nowrap">
                        ${escapeHTML(st.subject || 'Bộ môn')}
                      </span>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <p class="text-xs text-gray-400 italic">Chưa có giáo viên bộ môn</p>
              `}
            </div>
          </div>

          <!-- Class Card Actions -->
          <div class="mt-3.5 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
            <button type="button" onclick="window.taOpenAssignClassModal('${escapeHTML(className)}')" class="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap">
              <span>⚡</span>
              <span>Phân công giáo viên</span>
            </button>
            ${classAssignments.length > 0 ? `
              <button type="button" onclick="window.taDeleteAllTeachersForClass('${escapeHTML(className)}')" class="py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 transition-all cursor-pointer whitespace-nowrap shrink-0" title="Xóa toàn bộ phân công của lớp này">
                🗑️
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // ==========================================
  // VIEW 3: MA TRẬN TOÀN TRƯỜNG (MATRIX)
  // ==========================================
  function renderMatrixView() {
    const container = document.getElementById('ta-matrix-container');
    if (!container) return;

    let teachers = window.taState.teachers || [];
    let classes = window.taState.classes || [];
    const assignments = window.taState.assignments || [];

    const query = window.taState.searchQuery;
    const filterDonvi = window.taState.filterDonvi;
    const filterGrade = window.taState.filterGrade;

    // Lọc lớp theo khối & đơn vị
    classes = classes.filter(c => matchGrade(c, filterGrade));
    if (filterDonvi) {
      teachers = teachers.filter(t => String(t.donvi || '').toLowerCase() === filterDonvi);
    }
    if (query) {
      teachers = teachers.filter(t => String(t.full_name || t.username || '').toLowerCase().includes(query));
    }

    if (classes.length === 0 || teachers.length === 0) {
      container.innerHTML = `
        <div class="py-12 px-4 text-center text-gray-500 italic text-xs">
          Không có dữ liệu ma trận thỏa mãn bộ lọc hiện tại.
        </div>
      `;
      return;
    }

    // Xây dựng bảng ma trận
    let tableHtml = `
      <table class="w-full text-left border-collapse text-xs">
        <thead>
          <tr class="bg-gray-100/90 text-gray-700 border-b border-gray-200">
            <th class="p-3 sticky left-0 bg-gray-100 z-20 font-black min-w-[160px] sm:min-w-[200px] border-r border-gray-200 whitespace-nowrap shadow-xs">
              Giáo viên (${teachers.length})
            </th>
            ${classes.map(c => `
              <th class="p-2.5 text-center font-black min-w-[75px] sm:min-w-[90px] border-r border-gray-200 whitespace-nowrap">
                <button type="button" onclick="window.taOpenAssignClassModal('${escapeHTML(c)}')" class="hover:text-indigo-600 hover:underline cursor-pointer" title="Bấm để phân công cho lớp ${escapeHTML(c)}">
                  ${escapeHTML(c)}
                </button>
              </th>
            `).join('')}
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
    `;

    teachers.forEach((t, rowIdx) => {
      const assigned = t.assigned_classes || [];
      const rowBg = rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50';

      tableHtml += `
        <tr class="${rowBg} hover:bg-indigo-50/40 transition">
          <td class="p-2.5 sm:p-3 sticky left-0 ${rowBg} z-10 border-r border-gray-200 font-bold text-gray-900 flex items-center justify-between gap-2 shadow-xs whitespace-nowrap">
            <span class="truncate max-w-[130px] sm:max-w-[160px]">${escapeHTML(t.full_name || t.username)}</span>
            <button type="button" onclick="window.taOpenAssignTeacherModal('${t.id}')" class="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold underline shrink-0 cursor-pointer">
              Sửa
            </button>
          </td>
      `;

      classes.forEach(c => {
        const item = assigned.find(x => x.class_name.toLowerCase() === c.toLowerCase());
        if (item) {
          if (item.role === 'chu_nhiem') {
            tableHtml += `
              <td class="p-2 text-center border-r border-gray-200 bg-amber-50/80 cursor-pointer whitespace-nowrap" onclick="window.taOpenAssignTeacherModal('${t.id}')" title="Chủ nhiệm lớp ${escapeHTML(c)}">
                <span class="inline-flex items-center gap-0.5 px-2 py-0.5 bg-amber-400 text-slate-950 font-black text-[10px] rounded shadow-2xs whitespace-nowrap">
                  👑 CN
                </span>
                ${item.subject ? `<div class="text-[10px] text-amber-800 font-bold truncate max-w-[75px] mx-auto">${escapeHTML(item.subject)}</div>` : ''}
              </td>
            `;
          } else {
            tableHtml += `
              <td class="p-2 text-center border-r border-gray-200 bg-indigo-50/40 cursor-pointer whitespace-nowrap" onclick="window.taOpenAssignTeacherModal('${t.id}')" title="Dạy lớp ${escapeHTML(c)}: ${escapeHTML(item.subject || 'Bộ môn')}">
                <span class="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-800 font-bold text-[10px] rounded truncate max-w-[80px] whitespace-nowrap">
                  ${escapeHTML(item.subject || '✓')}
                </span>
              </td>
            `;
          }
        } else {
          tableHtml += `
            <td class="p-2 text-center border-r border-gray-200 text-gray-300 hover:bg-indigo-50/30 cursor-pointer whitespace-nowrap" onclick="window.taOpenAssignTeacherModal('${t.id}')" title="Gán ${escapeHTML(t.full_name)} vào ${escapeHTML(c)}">
              -
            </td>
          `;
        }
      });

      tableHtml += `</tr>`;
    });

    tableHtml += `</tbody></table>`;
    container.innerHTML = tableHtml;
  }

  // ==========================================
  // MODAL: PHÂN CÔNG LỚP CHO GIÁO VIÊN
  // ==========================================
  window.taOpenAssignTeacherModal = function (teacherId) {
    if (!teacherId) return;
    const searchIdStr = String(teacherId);
    let teacher = (window.taState.teachers || []).find(t =>
      String(t.id) === searchIdStr ||
      String(t.user_id) === searchIdStr ||
      String(t.username) === searchIdStr
    );
    if (!teacher) {
      const u = (window.usersList || []).find(x =>
        String(x.id) === searchIdStr ||
        String(x.user_id) === searchIdStr ||
        String(x.username) === searchIdStr
      );
      if (u) {
        teacher = {
          id: u.id || u.user_id || teacherId,
          username: u.username || u.id,
          full_name: u.full_name || u.ho_ten || u.username,
          donvi: u.donvi || '',
          assigned_classes: u.assigned_classes || []
        };
      }
    }
    if (!teacher && window.currentUser && (
      String(window.currentUser.id) === searchIdStr ||
      String(window.currentUser.user_id) === searchIdStr ||
      String(window.currentUser.username) === searchIdStr
    )) {
      teacher = {
        id: window.currentUser.id || window.currentUser.user_id || teacherId,
        username: window.currentUser.username,
        full_name: window.currentUser.full_name || window.currentUser.ho_ten || window.currentUser.username,
        donvi: window.currentUser.donvi || '',
        assigned_classes: []
      };
    }
    // Fallback đảm bảo không bao giờ bị đứng
    if (!teacher) {
      teacher = {
        id: teacherId,
        username: teacherId,
        full_name: teacherId,
        donvi: '',
        assigned_classes: []
      };
    }
    if (!window.taState.teachers) window.taState.teachers = [];
    if (!window.taState.teachers.some(t => String(t.id) === String(teacher.id))) {
      window.taState.teachers.push(teacher);
    }

    window.taState.currentEditTeacher = teacher;

    const modal = document.getElementById('modal-ta-assign-teacher');
    const nameEl = document.getElementById('modal-ta-teacher-name');
    const subEl = document.getElementById('modal-ta-teacher-sub');
    const inputCustom = document.getElementById('modal-ta-custom-class-input');

    if (nameEl) nameEl.textContent = teacher.full_name || teacher.username;
    if (subEl) subEl.textContent = `Đơn vị: ${teacher.donvi || 'Toàn trường'} | Mã/TK: ${teacher.username || teacher.id}`;
    if (inputCustom) inputCustom.value = '';

    // Chuẩn bị danh sách lớp học
    const assignedMap = new Map();
    (teacher.assigned_classes || []).forEach(c => {
      assignedMap.set(c.class_name.toLowerCase(), c);
    });

    const list = (window.taState.classes || []).map(cName => {
      const existing = assignedMap.get(cName.toLowerCase());
      return {
        class_name: cName,
        role: existing ? (existing.role || 'bo_mon') : 'bo_mon',
        subject: existing ? (existing.subject || '') : '',
        checked: Boolean(existing)
      };
    });

    window.taState.modalTeacherClasses = list;
    renderTeacherClassesChecklist();

    if (modal) modal.classList.remove('hidden');
  };

  window.taCloseAssignTeacherModal = function () {
    const modal = document.getElementById('modal-ta-assign-teacher');
    if (modal) modal.classList.add('hidden');
    window.taState.currentEditTeacher = null;
  };

  function renderTeacherClassesChecklist() {
    const container = document.getElementById('modal-ta-classes-checklist');
    const badgeCount = document.getElementById('modal-ta-selected-classes-count');
    if (!container) return;

    const list = window.taState.modalTeacherClasses || [];
    const checkedCount = list.filter(x => x.checked).length;
    if (badgeCount) badgeCount.textContent = `Đã chọn: ${checkedCount} lớp`;

    if (list.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 text-gray-400 text-xs italic">
          Chưa có lớp học nào trong hệ thống. Hãy nhập tên lớp ở ô phía trên và nhấn "Thêm lớp này".
        </div>
      `;
      return;
    }

    container.innerHTML = list.map((item, idx) => {
      const isChecked = Boolean(item.checked);
      return `
        <div class="p-2.5 sm:p-3 rounded-2xl border transition-all ${isChecked ? 'bg-indigo-50/60 border-indigo-200 shadow-2xs' : 'bg-white border-gray-200 opacity-70 hover:opacity-100'} flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <input type="checkbox" id="modal-tc-chk-${idx}" onchange="window.taToggleTeacherClassItem(${idx}, this.checked)" ${isChecked ? 'checked' : ''} class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0">
            <label for="modal-tc-chk-${idx}" class="font-bold text-xs sm:text-sm text-gray-900 cursor-pointer select-none truncate">
              <span class="px-2.5 py-0.5 rounded-lg ${isChecked ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'} font-black text-xs mr-1.5 transition inline-block whitespace-nowrap">
                ${escapeHTML(item.class_name)}
              </span>
            </label>
          </div>
          <div class="flex items-center gap-2 sm:justify-end ${isChecked ? '' : 'pointer-events-none opacity-40'}">
            <select onchange="window.taChangeTeacherClassRole(${idx}, this.value)" class="px-2.5 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-800 focus:outline-none focus:border-indigo-500 cursor-pointer shrink-0">
              <option value="bo_mon" ${item.role === 'bo_mon' ? 'selected' : ''}>Bộ môn</option>
              <option value="chu_nhiem" ${item.role === 'chu_nhiem' ? 'selected' : ''}>Chủ nhiệm 👑</option>
            </select>
            <div class="relative flex-1 sm:w-44">
              <input type="text" value="${escapeHTML(item.subject || '')}" placeholder="Môn dạy..." oninput="window.taChangeTeacherClassSubject(${idx}, this.value)" class="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500">
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.taToggleTeacherClassItem = function (idx, checked) {
    if (window.taState.modalTeacherClasses[idx]) {
      window.taState.modalTeacherClasses[idx].checked = checked;
      renderTeacherClassesChecklist();
    }
  };

  window.taChangeTeacherClassRole = function (idx, role) {
    if (window.taState.modalTeacherClasses[idx]) {
      window.taState.modalTeacherClasses[idx].role = role;
    }
  };

  window.taChangeTeacherClassSubject = function (idx, subject) {
    if (window.taState.modalTeacherClasses[idx]) {
      window.taState.modalTeacherClasses[idx].subject = subject;
    }
  };

  window.taToggleAllClassesForTeacher = function (selectAll) {
    (window.taState.modalTeacherClasses || []).forEach(x => {
      x.checked = selectAll;
    });
    renderTeacherClassesChecklist();
  };

  window.taApplySubjectChip = function (subject) {
    const list = window.taState.modalTeacherClasses || [];
    let updated = false;
    list.forEach(x => {
      if (x.checked && !x.subject) {
        x.subject = subject;
        updated = true;
      }
    });
    if (!updated) {
      // Nếu không có lớp nào được chọn, áp dụng cho tất cả lớp đang tick
      list.forEach(x => {
        if (x.checked) x.subject = subject;
      });
    }
    renderTeacherClassesChecklist();
  };

  window.taAddCustomClassToTeacherModal = function () {
    const input = document.getElementById('modal-ta-custom-class-input');
    if (!input) return;
    const val = input.value.trim().toUpperCase();
    if (!val) {
      if (typeof window.showToast === 'function') window.showToast('Vui lòng nhập tên lớp cần thêm!', 'warning');
      return;
    }

    const list = window.taState.modalTeacherClasses || [];
    const exists = list.find(x => x.class_name.toLowerCase() === val.toLowerCase());
    if (exists) {
      exists.checked = true;
      if (typeof window.showToast === 'function') window.showToast(`Lớp "${val}" đã có trong danh sách!`, 'info');
    } else {
      list.unshift({
        class_name: val,
        role: 'bo_mon',
        subject: '',
        checked: true
      });
      // Bổ sung vào state chung
      if (!window.taState.classes.includes(val)) {
        window.taState.classes.push(val);
      }
    }

    input.value = '';
    renderTeacherClassesChecklist();
  };

  window.taSaveTeacherClasses = async function () {
    if (!window.isAdminLoggedIn) {
      if (typeof window.showToast === 'function') {
        window.showToast('BẢO MẬT HỆ THỐNG: Chỉ Quản trị viên (Admin) mới có quyền phân công lại lớp!', 'error');
      }
      return;
    }

    const teacher = window.taState.currentEditTeacher;
    if (!teacher) return;

    const btn = document.getElementById('modal-ta-btn-save-teacher');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> <span>Đang lưu...</span>';
    }

    try {
      const selected = (window.taState.modalTeacherClasses || [])
        .filter(x => x.checked)
        .map(x => ({
          class_name: x.class_name,
          role: x.role || 'bo_mon',
          subject: x.subject || ''
        }));

      const token = getAuthToken();
      const res = await fetch('/api/teacher-classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          teacher_id: teacher.id,
          teacher_name: teacher.full_name || teacher.username,
          donvi: teacher.donvi || '',
          classes: selected
        })
      });

      const resJson = await res.json().catch(() => ({}));
      if (!res.ok || resJson.error) {
        throw new Error(resJson.error || 'Lỗi lưu phân công giáo viên');
      }

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã lưu phân công ${selected.length} lớp cho giáo viên ${teacher.full_name} thành công!`, 'success');
      }

      window.taCloseAssignTeacherModal();
      await window.initTeacherAssignmentApp(true);

    } catch (err) {
      console.error('Lỗi lưu phân công giáo viên:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('❌ Lỗi khi lưu phân công: ' + (err.message || ''), 'error');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>💾</span> <span>Lưu phân công giáo viên</span>';
      }
    }
  };

  // ==========================================
  // MODAL: PHÂN CÔNG GIÁO VIÊN CHO LỚP HỌC
  // ==========================================
  window.taOpenAssignClassModal = function (className) {
    if (!className) return;
    window.taState.currentEditClass = className;

    const modal = document.getElementById('modal-ta-assign-class');
    const nameEl = document.getElementById('modal-ta-class-name');
    const subEl = document.getElementById('modal-ta-class-sub');
    const cnSelect = document.getElementById('modal-ta-class-cn-select');

    if (nameEl) nameEl.textContent = `Lớp ${className}`;
    if (subEl) subEl.textContent = `Điều phối GV Chủ nhiệm và GV Bộ môn cho lớp ${className}`;

    // Lấy phân công hiện tại của lớp này
    const classAssignments = (window.taState.assignments || []).filter(a =>
      a.class_name.toLowerCase() === className.toLowerCase()
    );

    const homeroom = classAssignments.find(a => a.role === 'chu_nhiem');
    window.taState.modalClassHomeroomTeacherId = homeroom ? homeroom.teacher_id : '';

    // Đổ danh sách GV vào select GVCN
    if (cnSelect) {
      cnSelect.innerHTML = '<option value="">-- Chưa chọn Giáo viên Chủ nhiệm --</option>';
      (window.taState.teachers || []).forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.full_name || t.username} (${t.donvi || 'Toàn trường'})`;
        if (homeroom && homeroom.teacher_id === t.id) opt.selected = true;
        cnSelect.appendChild(opt);
      });
    }

    // Đổ danh sách GV bộ môn
    const subjectMap = new Map();
    classAssignments.filter(a => a.role === 'bo_mon').forEach(a => {
      subjectMap.set(a.teacher_id, a);
    });

    window.taState.modalClassTeachers = (window.taState.teachers || []).map(t => {
      const existing = subjectMap.get(t.id);
      return {
        teacher_id: t.id,
        teacher_name: t.full_name || t.username,
        donvi: t.donvi || '',
        subject: existing ? (existing.subject || '') : '',
        checked: Boolean(existing)
      };
    });

    renderClassTeachersList();

    if (modal) modal.classList.remove('hidden');
  };

  window.taCloseAssignClassModal = function () {
    const modal = document.getElementById('modal-ta-assign-class');
    if (modal) modal.classList.add('hidden');
    window.taState.currentEditClass = null;
  };

  function renderClassTeachersList() {
    const container = document.getElementById('modal-ta-class-teachers-list');
    const badgeCount = document.getElementById('modal-ta-class-bm-count');
    if (!container) return;

    const list = window.taState.modalClassTeachers || [];
    const checkedCount = list.filter(x => x.checked).length;
    if (badgeCount) badgeCount.textContent = `${checkedCount} giáo viên bộ môn`;

    if (list.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 text-gray-400 text-xs italic">
          Chưa có giáo viên nào trong danh sách.
        </div>
      `;
      return;
    }

    container.innerHTML = list.map((t, idx) => {
      const isChecked = Boolean(t.checked);
      return `
        <div class="p-2.5 sm:p-3 rounded-2xl border transition-all ${isChecked ? 'bg-indigo-50/60 border-indigo-200' : 'bg-white border-gray-200 opacity-70 hover:opacity-100'} flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <input type="checkbox" id="modal-ct-chk-${idx}" onchange="window.taToggleClassTeacherItem(${idx}, this.checked)" ${isChecked ? 'checked' : ''} class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0">
            <label for="modal-ct-chk-${idx}" class="font-bold text-xs sm:text-sm text-gray-900 cursor-pointer select-none truncate">
              <span>${escapeHTML(t.teacher_name)}</span>
              <span class="text-[11px] text-gray-500 font-normal">(${escapeHTML(t.donvi || 'Toàn trường')})</span>
            </label>
          </div>
          <div class="flex items-center gap-2 sm:justify-end ${isChecked ? '' : 'pointer-events-none opacity-40'}">
            <input type="text" value="${escapeHTML(t.subject || '')}" placeholder="Môn dạy (Toán, Văn...)" oninput="window.taChangeClassTeacherSubject(${idx}, this.value)" class="w-full sm:w-48 px-2.5 py-1.5 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500">
          </div>
        </div>
      `;
    }).join('');
  }

  window.taToggleClassTeacherItem = function (idx, checked) {
    if (window.taState.modalClassTeachers[idx]) {
      window.taState.modalClassTeachers[idx].checked = checked;
      renderClassTeachersList();
    }
  };

  window.taChangeClassTeacherSubject = function (idx, subject) {
    if (window.taState.modalClassTeachers[idx]) {
      window.taState.modalClassTeachers[idx].subject = subject;
    }
  };

  window.taSaveClassTeachers = async function () {
    if (!window.isAdminLoggedIn) {
      if (typeof window.showToast === 'function') {
        window.showToast('BẢO MẬT HỆ THỐNG: Chỉ Quản trị viên (Admin) mới có quyền phân công lại giáo viên!', 'error');
      }
      return;
    }

    const className = window.taState.currentEditClass;
    if (!className) return;

    const cnSelect = document.getElementById('modal-ta-class-cn-select');
    const homeroomTeacherId = cnSelect ? cnSelect.value : '';

    const btn = document.getElementById('modal-ta-btn-save-class');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> <span>Đang lưu...</span>';
    }

    try {
      const teachersToSave = [];

      // 1. Thêm GVCN nếu có chọn
      if (homeroomTeacherId) {
        const hrTeacher = (window.taState.teachers || []).find(t => t.id === homeroomTeacherId);
        if (hrTeacher) {
          teachersToSave.push({
            teacher_id: hrTeacher.id,
            teacher_name: hrTeacher.full_name || hrTeacher.username,
            donvi: hrTeacher.donvi || '',
            role: 'chu_nhiem',
            subject: ''
          });
        }
      }

      // 2. Thêm các GV bộ môn được tick
      (window.taState.modalClassTeachers || []).forEach(t => {
        if (t.checked) {
          // Tránh ghi đè nếu cùng là GVCN và GVBM
          const already = teachersToSave.find(x => x.teacher_id === t.teacher_id);
          if (already) {
            already.subject = t.subject || already.subject;
          } else {
            teachersToSave.push({
              teacher_id: t.teacher_id,
              teacher_name: t.teacher_name,
              donvi: t.donvi || '',
              role: 'bo_mon',
              subject: t.subject || ''
            });
          }
        }
      });

      const token = getAuthToken();
      const res = await fetch('/api/teacher-classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          by_class: true,
          class_name: className,
          teachers: teachersToSave
        })
      });

      const resJson = await res.json().catch(() => ({}));
      if (!res.ok || resJson.error) {
        throw new Error(resJson.error || 'Lỗi lưu phân công lớp học');
      }

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã lưu phân công cho lớp ${className} thành công!`, 'success');
      }

      window.taCloseAssignClassModal();
      await window.initTeacherAssignmentApp(true);

    } catch (err) {
      console.error('Lỗi khi lưu phân công lớp:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('❌ Lỗi khi lưu phân công: ' + (err.message || ''), 'error');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>💾</span> <span>Lưu phân công lớp này</span>';
      }
    }
  };

  // ==========================================
  // THAO TÁC XÓA & THÊM LỚP MỚI
  // ==========================================
  window.taDeleteAllClassesForTeacher = function (teacherId, teacherName) {
    if (typeof window.showConfirmModal === 'function') {
      window.showConfirmModal(`Bạn có chắc chắn muốn gỡ toàn bộ các lớp phân công của giáo viên "${teacherName}"?`, async () => {
        try {
          const token = getAuthToken();
          const res = await fetch(`/api/teacher-classes?teacher_id=${encodeURIComponent(teacherId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
          });
          if (res.ok) {
            if (typeof window.showToast === 'function') window.showToast('✅ Đã gỡ toàn bộ phân công của giáo viên!', 'success');
            await window.initTeacherAssignmentApp(true);
          } else {
            const err = await res.json().catch(() => ({}));
            if (typeof window.showToast === 'function') window.showToast('Lỗi: ' + (err.error || 'Không thể xóa'), 'error');
          }
        } catch (e) {
          if (typeof window.showToast === 'function') window.showToast('Lỗi kết nối khi gỡ phân công', 'error');
        }
      });
    }
  };

  window.taDeleteAllTeachersForClass = function (className) {
    if (typeof window.showConfirmModal === 'function') {
      window.showConfirmModal(`Bạn có chắc chắn muốn xóa toàn bộ phân công giáo viên của lớp "${className}"?`, async () => {
        try {
          const token = getAuthToken();
          const res = await fetch(`/api/teacher-classes?class_name=${encodeURIComponent(className)}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
          });
          if (res.ok) {
            if (typeof window.showToast === 'function') window.showToast(`✅ Đã xóa toàn bộ phân công của lớp ${className}!`, 'success');
            await window.initTeacherAssignmentApp(true);
          } else {
            const err = await res.json().catch(() => ({}));
            if (typeof window.showToast === 'function') window.showToast('Lỗi: ' + (err.error || 'Không thể xóa'), 'error');
          }
        } catch (e) {
          if (typeof window.showToast === 'function') window.showToast('Lỗi kết nối khi xóa phân công lớp', 'error');
        }
      });
    }
  };

  window.taOpenAddClassModal = function () {
    const modal = document.getElementById('modal-ta-add-class');
    const inputName = document.getElementById('modal-ta-new-class-name');
    const inputDonvi = document.getElementById('modal-ta-new-class-donvi');
    if (inputName) inputName.value = '';
    if (inputDonvi) {
      inputDonvi.value = (window.currentUser && window.currentUser.donvi) ? window.currentUser.donvi : '';
    }
    if (modal) modal.classList.remove('hidden');
  };

  window.taCloseAddClassModal = function () {
    const modal = document.getElementById('modal-ta-add-class');
    if (modal) modal.classList.add('hidden');
  };

  window.taConfirmAddNewClass = function () {
    const inputName = document.getElementById('modal-ta-new-class-name');
    if (!inputName) return;
    const val = inputName.value.trim().toUpperCase();
    if (!val) {
      if (typeof window.showToast === 'function') window.showToast('Vui lòng nhập tên lớp học!', 'warning');
      return;
    }

    if (!window.taState.classes.includes(val)) {
      window.taState.classes.push(val);
      window.taState.classes.sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
    }

    window.taCloseAddClassModal();
    if (typeof window.showToast === 'function') {
      window.showToast(`✅ Đã thêm lớp "${val}" vào danh sách điều phối!`, 'success');
    }
    window.taRenderCurrentView();
    updateStatSummary();
  };

  // ==========================================
  // XUẤT & NHẬP EXCEL
  // ==========================================
  window.taExportExcel = async function () {
    if (typeof window.ExcelJS === 'undefined') {
      if (typeof window.showToast === 'function') window.showToast('Thư viện ExcelJS đang nạp, vui lòng thử lại sau giây lát!', 'warning');
      return;
    }

    try {
      const workbook = new window.ExcelJS.Workbook();
      workbook.creator = 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN';
      workbook.created = new Date();

      // Sheet 1: Theo Giáo viên
      const wsTeachers = workbook.addWorksheet('PhanCong_TheoGiaoVien');
      wsTeachers.columns = [
        { header: 'STT', key: 'stt', width: 6 },
        { header: 'Mã/Tài khoản GV', key: 'username', width: 18 },
        { header: 'Họ và tên Giáo viên', key: 'name', width: 26 },
        { header: 'Đơn vị / Trường', key: 'donvi', width: 24 },
        { header: 'Lớp phụ trách', key: 'lop', width: 14 },
        { header: 'Vai trò', key: 'role', width: 16 },
        { header: 'Môn dạy', key: 'subject', width: 18 }
      ];

      // Định dạng Header Sheet 1
      wsTeachers.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      wsTeachers.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
      wsTeachers.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

      let stt = 1;
      (window.taState.teachers || []).forEach(t => {
        const assigned = t.assigned_classes || [];
        if (assigned.length === 0) {
          wsTeachers.addRow({
            stt: stt++,
            username: t.username || t.id,
            name: t.full_name || t.username,
            donvi: t.donvi || '',
            lop: 'Chưa phân công',
            role: '',
            subject: ''
          });
        } else {
          assigned.forEach(c => {
            wsTeachers.addRow({
              stt: stt++,
              username: t.username || t.id,
              name: t.full_name || t.username,
              donvi: t.donvi || '',
              lop: c.class_name,
              role: c.role === 'chu_nhiem' ? 'Chủ nhiệm' : 'Bộ môn',
              subject: c.subject || ''
            });
          });
        }
      });

      // Sheet 2: Theo Lớp học
      const wsClasses = workbook.addWorksheet('PhanCong_TheoLopHoc');
      wsClasses.columns = [
        { header: 'STT', key: 'stt', width: 6 },
        { header: 'Lớp học', key: 'lop', width: 14 },
        { header: 'GV Chủ nhiệm', key: 'gvcn', width: 26 },
        { header: 'GV Bộ môn & Phân công', key: 'gvbm', width: 50 }
      ];

      wsClasses.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      wsClasses.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
      wsClasses.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

      let sttCls = 1;
      (window.taState.classes || []).forEach(className => {
        const classAssignments = (window.taState.assignments || []).filter(a =>
          a.class_name.toLowerCase() === className.toLowerCase()
        );
        const homeroom = classAssignments.find(a => a.role === 'chu_nhiem');
        const subjectTeachers = classAssignments.filter(a => a.role === 'bo_mon')
          .map(a => `${a.teacher_name} (${a.subject || 'Bộ môn'})`).join(', ');

        wsClasses.addRow({
          stt: sttCls++,
          lop: className,
          gvcn: homeroom ? homeroom.teacher_name : 'Chưa có',
          gvbm: subjectTeachers || 'Chưa có'
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const nowStr = new Date().toISOString().slice(0, 10);
      if (typeof window.saveAs === 'function') {
        window.saveAs(blob, `Phan_Cong_Giao_Vien_${nowStr}.xlsx`);
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Phan_Cong_Giao_Vien_${nowStr}.xlsx`;
        link.click();
      }

      if (typeof window.showToast === 'function') {
        window.showToast('✅ Đã xuất file Excel phân công giáo viên thành công!', 'success');
      }

    } catch (err) {
      console.error('Lỗi xuất Excel phân công:', err);
      if (typeof window.showToast === 'function') window.showToast('Lỗi xuất Excel: ' + err.message, 'error');
    }
  };

  window.taOpenImportModal = function () {
    const modal = document.getElementById('modal-ta-import-excel');
    const input = document.getElementById('ta-import-excel-file');
    const previewContainer = document.getElementById('ta-import-preview-container');
    const btnConfirm = document.getElementById('ta-btn-confirm-import');
    if (input) input.value = '';
    if (previewContainer) previewContainer.classList.add('hidden');
    if (btnConfirm) btnConfirm.disabled = true;
    window.taState.excelImportData = [];
    if (modal) modal.classList.remove('hidden');
  };

  window.taCloseImportModal = function () {
    const modal = document.getElementById('modal-ta-import-excel');
    if (modal) modal.classList.add('hidden');
  };

  window.taDownloadExcelTemplate = async function () {
    if (typeof window.ExcelJS === 'undefined') return;
    const wb = new window.ExcelJS.Workbook();
    const ws = wb.addWorksheet('MauPhanCong');
    ws.columns = [
      { header: 'Họ tên GV (*)', key: 'name', width: 24 },
      { header: 'Mã hoặc TK GV', key: 'username', width: 18 },
      { header: 'Lớp (*)', key: 'lop', width: 14 },
      { header: 'Vai trò (chu_nhiem hoặc bo_mon)', key: 'role', width: 28 },
      { header: 'Môn dạy', key: 'subject', width: 18 },
      { header: 'Đơn vị / Trường', key: 'donvi', width: 22 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.addRow({ name: 'Nguyễn Văn A', username: 'gv_a', lop: '12A1', role: 'chu_nhiem', subject: 'Toán', donvi: 'THPT ABC' });
    ws.addRow({ name: 'Trần Thị B', username: 'gv_b', lop: '12A1', role: 'bo_mon', subject: 'Ngữ văn', donvi: 'THPT ABC' });
    ws.addRow({ name: 'Nguyễn Văn A', username: 'gv_a', lop: '11B2', role: 'bo_mon', subject: 'Toán', donvi: 'THPT ABC' });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (typeof window.saveAs === 'function') window.saveAs(blob, 'Mau_Phan_Cong_Giao_Vien.xlsx');
  };

  window.taHandleExcelFileChosen = async function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const wb = new window.ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('File không có sheet nào');

      const items = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Bỏ qua Header
        const nameVal = String(row.getCell(1).value || '').trim();
        const usernameVal = String(row.getCell(2).value || '').trim();
        const lopVal = String(row.getCell(3).value || '').trim().toUpperCase();
        let roleVal = String(row.getCell(4).value || '').trim().toLowerCase();
        const subVal = String(row.getCell(5).value || '').trim();
        const donviVal = String(row.getCell(6).value || '').trim();

        if (roleVal.includes('chủ nhiệm') || roleVal === 'cn') roleVal = 'chu_nhiem';
        else roleVal = 'bo_mon';

        if (lopVal && (nameVal || usernameVal)) {
          // Tìm teacher_id
          const matchedTeacher = (window.taState.teachers || []).find(t =>
            (usernameVal && String(t.username || '').toLowerCase() === usernameVal.toLowerCase()) ||
            (nameVal && String(t.full_name || '').toLowerCase() === nameVal.toLowerCase())
          );

          items.push({
            teacher_id: matchedTeacher ? matchedTeacher.id : (usernameVal || nameVal),
            teacher_name: nameVal || (matchedTeacher ? matchedTeacher.full_name : usernameVal),
            class_name: lopVal,
            role: roleVal,
            subject: subVal,
            donvi: donviVal || (matchedTeacher ? matchedTeacher.donvi : '')
          });
        }
      });

      window.taState.excelImportData = items;

      const previewContainer = document.getElementById('ta-import-preview-container');
      const previewList = document.getElementById('ta-import-preview-list');
      const countBadge = document.getElementById('ta-import-count-badge');
      const btnConfirm = document.getElementById('ta-btn-confirm-import');

      if (items.length === 0) {
        if (typeof window.showToast === 'function') window.showToast('Không tìm thấy dòng phân công hợp lệ trong file!', 'warning');
        return;
      }

      if (countBadge) countBadge.textContent = `${items.length} bản ghi`;
      if (previewList) {
        previewList.innerHTML = items.slice(0, 15).map(it => `
          <div class="flex items-center justify-between p-1 bg-white rounded border border-gray-100">
            <span><strong>${escapeHTML(it.teacher_name)}</strong> → Lớp <strong>${escapeHTML(it.class_name)}</strong></span>
            <span class="text-indigo-600 font-bold">${it.role === 'chu_nhiem' ? '👑 Chủ nhiệm' : '📖 ' + (it.subject || 'Bộ môn')}</span>
          </div>
        `).join('') + (items.length > 15 ? `<div class="text-center text-gray-500 py-1 italic">... và ${items.length - 15} bản ghi khác</div>` : '');
      }

      if (previewContainer) previewContainer.classList.remove('hidden');
      if (btnConfirm) btnConfirm.disabled = false;

    } catch (err) {
      console.error('Lỗi đọc file Excel:', err);
      if (typeof window.showToast === 'function') window.showToast('Không thể đọc file Excel: ' + err.message, 'error');
    }
  };

  window.taConfirmImportExcel = async function () {
    const items = window.taState.excelImportData || [];
    if (items.length === 0) return;

    const btnConfirm = document.getElementById('ta-btn-confirm-import');
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Đang nhập...';
    }

    try {
      const token = getAuthToken();
      const res = await fetch('/api/teacher-classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          batch: true,
          items: items
        })
      });

      const resJson = await res.json().catch(() => ({}));
      if (!res.ok || resJson.error) {
        throw new Error(resJson.error || 'Lỗi nhập dữ liệu');
      }

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã nhập thành công ${resJson.count || items.length} bản ghi phân công vào hệ thống!`, 'success');
      }

      window.taCloseImportModal();
      await window.initTeacherAssignmentApp(true);

    } catch (err) {
      console.error('Lỗi khi nhập Excel phân công:', err);
      if (typeof window.showToast === 'function') window.showToast('Lỗi nhập Excel: ' + err.message, 'error');
    } finally {
      if (btnConfirm) {
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'Tiến hành nhập';
      }
    }
  };

})();
