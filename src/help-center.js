import { HELP_GUIDES } from './help-center-content.js';

const safe = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

export function helpRole({ user = null, isAdmin = false, isTeacher = false } = {}) {
  if (!user) return 'guest';
  if (isAdmin) return 'admin';
  if (isTeacher) return 'teacher';
  const role = String(user.role || '').toLocaleLowerCase('vi').trim();
  const audience = String(user.target_audience || '').toLocaleLowerCase('vi').trim();
  if (role === 'admin' || audience === 'admin' || audience === 'quản trị viên') return 'admin';
  if (role === 'teacher' || role === 'giáo viên' || audience === 'giáo viên') return 'teacher';
  if (role === 'student' || role === 'học sinh' || audience === 'học sinh') return 'student';
  return 'guest'; // Fail closed on unknown authenticated audience.
}
export function helpVisibleSectionIds(role) {
  return (HELP_GUIDES[role]?.sections || []).map(section => section.id);
}
const palettes = {
  guest: {accent:'emerald', emoji:'🌐'},
  admin: {accent:'purple', emoji:'🛡️'},
  teacher: {accent:'blue', emoji:'👩‍🏫'},
  student: {accent:'emerald', emoji:'🎓'}
};
function guestView() {
  return guideView('guest');
}
function guestExtra(guide) {
  const yes = guide.eligibility.map(item => {
    const statusColor = item.access === 'yes' ? 'text-emerald-800 bg-emerald-50 border-emerald-200' :
      item.access === 'no' ? 'text-rose-800 bg-rose-50 border-rose-200' : 'text-amber-900 bg-amber-50 border-amber-200';
    return '<article class="rounded-xl border border-slate-200 p-4 bg-white">'
      + '<h4 class="font-black text-slate-900 text-sm sm:text-base">' + safe(item.mode) + '</h4>'
      + '<span class="inline-block mt-2 rounded-full border px-2.5 py-1 text-xs font-bold ' + statusColor + '">' + safe(item.status) + '</span>'
      + '<p class="mt-2 text-sm leading-6 text-slate-600">' + safe(item.condition) + '</p></article>';
  }).join('');
  return '<section class="mb-7 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 sm:p-5" aria-label="Giới thiệu nhanh">'
    + '<h3 class="font-black text-emerald-950 text-lg">🌐 Chào mừng bạn đến với hệ thống</h3>'
    + '<p class="mt-2 text-sm text-emerald-900 leading-6">Bạn chưa đăng nhập nhưng vẫn có thể xem hướng dẫn và tham gia các đề thi được phép. Đọc thông tin bên dưới để chọn đúng loại đề, bảo vệ kết quả và quyết định khi nào cần tài khoản.</p>'
    + '<div class="mt-4 flex flex-wrap gap-2">'
    + '<button type="button" data-help-login class="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold">🔐 Đăng nhập</button>'
    + '<button type="button" data-help-tab="exam" class="px-4 py-2.5 rounded-xl bg-white border border-emerald-300 text-emerald-900 text-sm font-bold hover:bg-emerald-100">📝 Vào làm bài</button>'
    + '</div></section>'
    + '<section class="mb-8"><h3 class="text-lg font-black text-slate-900 mb-3">✨ Tổng quan các tính năng</h3>'
    + '<div class="grid sm:grid-cols-2 gap-3">' + guide.features.map(([emoji,name,detail]) => '<div class="rounded-xl border border-slate-200 p-4 bg-slate-50"><h4 class="font-bold text-slate-900">' + safe(emoji) + ' ' + safe(name) + '</h4><p class="text-sm leading-6 text-slate-600 mt-2">' + safe(detail) + '</p></div>').join('') + '</div></section>'
    + '<section class="mb-8"><h3 class="text-lg font-black text-slate-900 mb-3">📋 Khi chưa đăng nhập, bạn có thể thi đề nào?</h3>'
    + '<div class="grid md:grid-cols-2 gap-3">' + yes + '</div></section>'
    + '<section class="mb-8"><h3 class="text-lg font-black text-slate-900 mb-3">🔎 Quyền lợi trước và sau khi đăng nhập</h3>'
    + '<div class="overflow-x-auto rounded-xl border border-slate-200"><table class="min-w-[620px] w-full text-left text-sm">'
    + '<thead class="bg-slate-100 text-slate-900"><tr><th class="p-3">Chức năng</th><th class="p-3">Chưa đăng nhập</th><th class="p-3">Đăng nhập tài khoản học sinh</th></tr></thead>'
    + '<tbody>' + guide.comparison.map(([name,guest,student]) => '<tr class="border-t border-slate-200"><th scope="row" class="p-3 font-semibold text-slate-900">' + safe(name) + '</th><td class="p-3 text-slate-700">' + safe(guest) + '</td><td class="p-3 text-slate-700">' + safe(student) + '</td></tr>').join('') + '</tbody></table></div>'
    + '<p class="mt-2 text-xs text-slate-500">Trên điện thoại, vuốt ngang bảng để xem hết các cột.</p></section>';
}
function sectionHtml(section, index, open = false) {
  const steps = section.steps.map(([title, description], i) =>
    '<li class="flex gap-3 items-start"><span class="flex-none w-7 h-7 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-black">'
    + (i+1) + '</span><div class="min-w-0"><strong class="block text-sm text-slate-900">' + safe(title) + '</strong>'
    + '<p class="mt-1 text-sm text-slate-600 leading-6">' + safe(description) + '</p></div></li>').join('');
  return '<details class="help-topic group rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden" data-help-section="' + safe(section.id) + '"' + (open?' open':'') + '>'
    + '<summary class="cursor-pointer list-none flex items-center gap-3 p-4 sm:p-5 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600">'
    + '<span class="flex-none w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 font-black text-slate-700">' + (index+1) + '</span>'
    + '<span class="flex-1 min-w-0"><strong class="block text-base sm:text-lg text-slate-900">' + safe(section.title) + '</strong>'
    + '<span class="block text-xs sm:text-sm text-slate-500 leading-5 mt-1">' + safe(section.summary) + '</span></span>'
    + '<span class="text-lg text-slate-400 group-open:rotate-180 transition-transform" aria-hidden="true">⌄</span></summary>'
    + '<div class="px-4 sm:px-6 pb-6 border-t border-slate-100"><ol class="space-y-5 pt-5">' + steps + '</ol>'
    + (section.note?'<p class="mt-5 text-sm leading-6 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900"><strong>Lưu ý:</strong> '+safe(section.note)+'</p>':'')
    + '</div></details>';
}
function guideView(role, filter = '') {
  const guide = HELP_GUIDES[role];
  if (!guide) return guestView();
  const q = filter.toLocaleLowerCase('vi').trim();
  const match = item => !q || JSON.stringify(item).toLocaleLowerCase('vi').includes(q);
  const sections = guide.sections.map((section,index)=>({section,index})).filter(({section})=>match(section));
  const faq = guide.faqs.filter(match);
  const palette = palettes[role];
  return '<header class="mb-6"><div class="flex flex-wrap items-center gap-2 mb-3"><span aria-hidden="true" class="text-3xl">' + palette.emoji + '</span>'
    + '<span class="rounded-full px-3 py-1 bg-slate-100 text-slate-700 text-xs font-black">Dành riêng cho '+safe(guide.label)+'</span></div>'
    + '<h2 class="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Trung tâm trợ giúp và hướng dẫn</h2>'
    + '<p class="mt-3 text-sm sm:text-base text-slate-600 leading-7 max-w-4xl">' + safe(guide.intro) + '</p>'
    + '<p class="mt-4 bg-amber-50 border-l-4 border-amber-400 rounded-r-xl px-4 py-3 text-sm leading-6 text-amber-950">' + safe(guide.highlight) + '</p></header>'
    + (role === 'guest' ? guestExtra(guide) : '')
    + '<div class="mb-6"><label for="help-search" class="block text-sm font-bold text-slate-700 mb-2">🔎 Tìm nhanh trong hướng dẫn</label>'
    + '<input id="help-search" type="search" autocomplete="off" placeholder="Nhập chức năng, bước thực hiện hoặc lỗi cần tìm..." value="' + safe(filter) + '"'
    + ' class="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm text-slate-800 focus:outline-none focus:border-blue-500" /></div>'
    + (!q ? '<div class="mb-7"><h3 class="font-black text-slate-900 mb-3">Đi tới chức năng</h3><nav aria-label="Mở chức năng theo vai trò" class="flex flex-wrap gap-2">'
      + guide.links.map(([tab,label,emoji])=>'<button type="button" data-help-tab="'+safe(tab)+'" class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600">'+safe(emoji)+' '+safe(label)+'</button>').join('')
      + '</nav></div>' : '')
    + '<section class="mb-8" aria-label="Hướng dẫn từng bước"><div class="flex flex-wrap justify-between gap-3 items-center mb-3">'
    + '<h3 class="text-lg sm:text-xl font-black text-slate-900">Hướng dẫn thao tác từng bước <span class="text-sm text-slate-500 font-normal">('+sections.length+' chủ đề)</span></h3>'
    + '<div class="flex gap-2"><button type="button" data-help-expand="yes" class="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold">Mở tất cả</button>'
    + '<button type="button" data-help-expand="no" class="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold">Thu gọn</button></div></div>'
    + (sections.length?'<div class="space-y-3">'+sections.map(({section,index},i)=>sectionHtml(section,index,i===0&&!q)).join('')+'</div>'
    : '<p class="rounded-xl bg-slate-50 p-5 text-slate-600">Không tìm thấy nội dung phù hợp. Hãy thử một từ khóa khác.</p>')+'</section>'
    + (faq.length?'<section aria-label="Câu hỏi thường gặp" class="border-t border-slate-200 pt-6"><h3 class="text-lg sm:text-xl font-black mb-4 text-slate-900">❓ Câu hỏi thường gặp</h3>'
    + '<div class="space-y-3">'+faq.map(([question,answer])=>'<details class="rounded-xl border border-slate-200 bg-slate-50 p-4"><summary class="cursor-pointer font-bold text-sm text-slate-900">'+safe(question)+'</summary><p class="mt-3 leading-6 text-sm text-slate-600">'+safe(answer)+'</p></details>').join('')+'</div></section>':'');
}
let lastRole = '';
let lastRoot = null;
export function renderRoleHelp(root, auth = {}, {force = false} = {}) {
  if (!root) return 'missing';
  const role = helpRole(auth);
  if (!force && root === lastRoot && role === lastRole && root.firstElementChild) return role;
  lastRoot = root; lastRole = role;
  root.dataset.helpRole = role;
  root.replaceChildren();
  root.innerHTML = role === 'guest' ? guestView() : guideView(role);
  return role;
}
export function attachRoleHelpInteractions(root) {
  if (!root || root.dataset.helpBound === 'yes') return;
  root.dataset.helpBound = 'yes';
  root.addEventListener('input', event => {
    if (event.target?.id !== 'help-search') return;
    const role = root.dataset.helpRole;
    if (!HELP_GUIDES[role]) return;
    const input = event.target;
    const query = input.value;
    const start = input.selectionStart;
    root.innerHTML = guideView(role, query);
    const next = root.querySelector('#help-search');
    next?.focus({ preventScroll: true });
    try { next?.setSelectionRange(start, start); } catch {}
  });
  root.addEventListener('click', event => {
    if (event.target.closest('[data-help-login]')) {
      window.showAdminLoginModal?.();
      return;
    }
    const tab = event.target.closest('[data-help-tab]')?.getAttribute('data-help-tab');
    if (tab && HELP_GUIDES[root.dataset.helpRole]?.links.some(item=>item[0]===tab)) {
      window.switchTab?.(tab);
      return;
    }
    const expand = event.target.closest('[data-help-expand]')?.getAttribute('data-help-expand');
    if (expand) root.querySelectorAll('details.help-topic').forEach(item => item.open = expand === 'yes');
  });
}
export function resetRoleHelpCache() { lastRole = ''; lastRoot = null; }
