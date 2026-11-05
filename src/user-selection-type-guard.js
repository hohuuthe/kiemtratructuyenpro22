const TYPE_STUDENT = 'student';
const TYPE_TEACHER = 'teacher';

function normalizeTypeText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('vi');
}

function usersSource() {
  if (Array.isArray(window.usersList)) return window.usersList;
  try {
    if (typeof usersList !== 'undefined' && Array.isArray(usersList)) return usersList;
  } catch {}
  return [];
}

function accountsSource() {
  if (Array.isArray(window.accounts)) return window.accounts;
  try {
    if (typeof accounts !== 'undefined' && Array.isArray(accounts)) return accounts;
  } catch {}
  return [];
}

function findUser(userId) {
  const uid = String(userId ?? '');
  return usersSource().find(u => String(u?.id ?? '') === uid) || null;
}

function findAccount(userId) {
  const uid = String(userId ?? '');
  return accountsSource().find(a =>
    String(a?.user_id ?? '') === uid || String(a?.id ?? '') === uid
  ) || null;
}

function classifyUserId(userId) {
  const user = findUser(userId);
  const account = findAccount(userId);
  const audience = normalizeTypeText(user?.target_audience);
  const role = normalizeTypeText(user?.role || user?.account_role || account?.role);
  const username = normalizeTypeText(account?.username || user?.username);
  const accountId = normalizeTypeText(account?.id);
  const id = normalizeTypeText(user?.id || userId);

  const isAdmin = audience === 'quản trị viên' || audience === 'admin' ||
    role === 'admin' || username === 'admin' || username === 'adminhht' ||
    accountId === 'admin' || accountId === 'adminhht' || id === 'adminhht';

  if (isAdmin) return 'admin';
  if (audience === 'học sinh' || audience === 'student' || role === 'student' || role === 'học sinh') {
    return TYPE_STUDENT;
  }
  if (audience === 'giáo viên' || audience === 'teacher' || role === 'teacher' || role === 'giáo viên') {
    return TYPE_TEACHER;
  }
  return 'other';
}

function typeLabel(type) {
  if (type === TYPE_STUDENT) return 'Học sinh';
  if (type === TYPE_TEACHER) return 'Giáo viên';
  if (type === 'admin') return 'Quản trị viên';
  return 'khác';
}

function selectedTypeState() {
  const ids = window.selectedUserIds ? Array.from(window.selectedUserIds).map(String) : [];
  const types = new Set(ids.map(classifyUserId).filter(t => t === TYPE_STUDENT || t === TYPE_TEACHER));
  return {
    ids,
    types,
    lockedType: types.size === 1 ? Array.from(types)[0] : null,
    mixed: types.size > 1
  };
}

function toast(message, level = 'warning') {
  if (typeof window.showToast === 'function') {
    window.showToast(message, level);
    return;
  }
  try {
    if (typeof showToast === 'function') showToast(message, level);
  } catch {}
}

function rowFor(id) {
  return document.getElementById('user-row-' + id);
}

function setRowSelected(id, selected) {
  const row = rowFor(id);
  if (!row) return;
  if (selected) row.classList.add('bg-purple-50/60');
  else row.classList.remove('bg-purple-50/60', 'bg-blue-50/60');
}

function applyTypeLockToVisibleCheckboxes() {
  const state = selectedTypeState();
  const lockedType = state.lockedType;
  document.querySelectorAll('.user-row-checkbox').forEach(cb => {
    const uid = String(cb.getAttribute('data-user-id') || '');
    if (!uid) return;
    const type = classifyUserId(uid);
    const alreadySelected = window.selectedUserIds?.has?.(uid);

    // Admin is never eligible for destructive multi-selection.
    const incompatible = type === 'admin' ||
      (lockedType && type !== lockedType) ||
      (type !== TYPE_STUDENT && type !== TYPE_TEACHER);

    cb.disabled = Boolean(incompatible && !alreadySelected);
    cb.classList.toggle('opacity-40', Boolean(incompatible && !alreadySelected));
    cb.classList.toggle('cursor-not-allowed', Boolean(incompatible && !alreadySelected));

    if (type === 'admin') {
      cb.title = 'Hồ sơ Quản trị viên được bảo vệ, không thể chọn để xóa.';
    } else if (lockedType && type !== lockedType) {
      cb.title = 'Đang chọn nhóm ' + typeLabel(lockedType) + '. Không thể chọn lẫn ' + typeLabel(type) + '.';
    } else if (type !== TYPE_STUDENT && type !== TYPE_TEACHER) {
      cb.title = 'Chỉ hỗ trợ chọn hàng loạt Học sinh hoặc Giáo viên.';
    } else {
      cb.title = '';
    }
  });
}

function repairMixedSelectionIfNeeded() {
  const state = selectedTypeState();
  if (!state.mixed) return false;

  // Fail closed: do not guess which type the administrator intended.
  // Clear the invalid mixed selection completely.
  window.selectedUserIds = new Set();
  document.querySelectorAll('.user-row-checkbox').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('[id^="user-row-"]').forEach(row => {
    row.classList.remove('bg-purple-50/60', 'bg-blue-50/60');
  });
  toast('⚠️ Đã hủy lựa chọn hỗn hợp. Chỉ được chọn cùng một loại: Học sinh hoặc Giáo viên.', 'warning');
  return true;
}

function installSelectionGuard() {
  const originalToggleOne = window.toggleSelectUser;
  const originalToggleAll = window.toggleSelectAllUsers;
  const originalUpdate = window.updateSelectedUsersUI;
  const originalDelete = window.confirmDeleteSelectedUsers;

  if (typeof originalToggleOne !== 'function' ||
      typeof originalToggleAll !== 'function' ||
      typeof originalUpdate !== 'function' ||
      typeof originalDelete !== 'function') {
    return false;
  }
  if (originalToggleOne.__homogeneousTypeGuard) return true;

  const guardedToggleOne = function(userId, checkbox) {
    const uid = String(userId ?? '');
    if (!uid) return;

    if (!window.selectedUserIds) window.selectedUserIds = new Set();

    if (checkbox?.checked) {
      const candidateType = classifyUserId(uid);
      if (candidateType === 'admin') {
        checkbox.checked = false;
        toast('❌ Hồ sơ Quản trị viên được bảo vệ, không thể chọn để xóa.', 'error');
        applyTypeLockToVisibleCheckboxes();
        return;
      }
      if (candidateType !== TYPE_STUDENT && candidateType !== TYPE_TEACHER) {
        checkbox.checked = false;
        toast('⚠️ Chỉ được chọn hàng loạt hồ sơ Học sinh hoặc Giáo viên.', 'warning');
        applyTypeLockToVisibleCheckboxes();
        return;
      }

      const state = selectedTypeState();
      if (state.lockedType && state.lockedType !== candidateType) {
        checkbox.checked = false;
        toast(
          '⚠️ Không được chọn lẫn Học sinh và Giáo viên. Danh sách hiện tại đang khóa theo loại ' +
          typeLabel(state.lockedType) + '.',
          'warning'
        );
        applyTypeLockToVisibleCheckboxes();
        return;
      }
    }

    originalToggleOne(userId, checkbox);
    repairMixedSelectionIfNeeded();
    applyTypeLockToVisibleCheckboxes();
  };
  guardedToggleOne.__homogeneousTypeGuard = true;
  guardedToggleOne.__original = originalToggleOne;
  window.toggleSelectUser = guardedToggleOne;

  const guardedToggleAll = function(masterCheckbox) {
    const wantsChecked = Boolean(masterCheckbox?.checked);
    if (!window.selectedUserIds) window.selectedUserIds = new Set();

    if (!wantsChecked) {
      originalToggleAll(masterCheckbox);
      applyTypeLockToVisibleCheckboxes();
      return;
    }

    const visible = Array.from(document.querySelectorAll('.user-row-checkbox'))
      .map(cb => ({
        cb,
        id: String(cb.getAttribute('data-user-id') || ''),
        type: classifyUserId(cb.getAttribute('data-user-id'))
      }))
      .filter(x => x.id && (x.type === TYPE_STUDENT || x.type === TYPE_TEACHER));

    const state = selectedTypeState();
    let targetType = state.lockedType;

    if (!targetType) {
      const visibleTypes = new Set(visible.map(x => x.type));
      if (visibleTypes.size !== 1) {
        if (masterCheckbox) {
          masterCheckbox.checked = false;
          masterCheckbox.indeterminate = window.selectedUserIds.size > 0;
        }
        toast(
          '⚠️ Trang hiện tại có cả Học sinh và Giáo viên. Hãy chọn một hồ sơ trước; sau đó “Chọn tất cả” chỉ chọn thêm đúng loại đó.',
          'warning'
        );
        applyTypeLockToVisibleCheckboxes();
        return;
      }
      targetType = Array.from(visibleTypes)[0];
    }

    visible.forEach(({ cb, id, type }) => {
      const shouldSelect = type === targetType;
      cb.checked = shouldSelect;
      if (shouldSelect) {
        window.selectedUserIds.add(id);
        setRowSelected(id, true);
      } else {
        window.selectedUserIds.delete(id);
        setRowSelected(id, false);
      }
    });

    if (masterCheckbox) {
      const eligible = visible.filter(x => x.type === targetType);
      masterCheckbox.checked = eligible.length > 0 && eligible.every(x => x.cb.checked);
      masterCheckbox.indeterminate = false;
    }

    originalUpdate();
    applyTypeLockToVisibleCheckboxes();
  };
  guardedToggleAll.__homogeneousTypeGuard = true;
  guardedToggleAll.__original = originalToggleAll;
  window.toggleSelectAllUsers = guardedToggleAll;

  const guardedUpdate = function() {
    if (!repairMixedSelectionIfNeeded()) {
      originalUpdate();
    } else {
      originalUpdate();
    }
    applyTypeLockToVisibleCheckboxes();
  };
  guardedUpdate.__homogeneousTypeGuard = true;
  guardedUpdate.__original = originalUpdate;
  window.updateSelectedUsersUI = guardedUpdate;

  const guardedDelete = function(...args) {
    const state = selectedTypeState();
    if (state.mixed) {
      repairMixedSelectionIfNeeded();
      originalUpdate();
      applyTypeLockToVisibleCheckboxes();
      return;
    }

    const selectedTypes = new Set(
      state.ids
        .map(classifyUserId)
        .filter(t => t === TYPE_STUDENT || t === TYPE_TEACHER)
    );

    if (selectedTypes.size > 1) {
      toast('❌ Không thể xóa đồng thời Học sinh và Giáo viên. Hãy chọn lại cùng một loại hồ sơ.', 'error');
      return;
    }

    return originalDelete.apply(this, args);
  };
  guardedDelete.__homogeneousTypeGuard = true;
  guardedDelete.__original = originalDelete;
  window.confirmDeleteSelectedUsers = guardedDelete;

  applyTypeLockToVisibleCheckboxes();
  return true;
}

if (!installSelectionGuard()) {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (installSelectionGuard() || attempts > 150) clearInterval(timer);
  }, 100);
}

// Re-apply the lock after pagination/filter rendering creates new row checkboxes.
const observer = new MutationObserver(() => {
  if (window.selectedUserIds) applyTypeLockToVisibleCheckboxes();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
