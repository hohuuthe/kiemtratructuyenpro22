import { initializeAppVersionGate, startAppVersionMonitoring } from './app-version-manager.js';

async function bootApplication() {
  const canContinue = await initializeAppVersionGate();
  if (!canContinue) return;

  await import('./modal-behavior.js');
  await import('./main.js');
  await import('./contest-mode-ui.js');
  await import('./exam-invalid-pool-guard.js');
  await Promise.all([
    import('./student-attempt-history-controller.js'),
    import('./teacher-delete-ui.js'),
    import('./batch-teacher-delete-ui.js')
  ]);
  // The guard wraps handlers installed by the batch controller; load it last.
  await import('./user-selection-type-guard.js');

  startAppVersionMonitoring();
}

bootApplication().catch((error) => {
  console.error('[Bootstrap] Không thể khởi động ứng dụng:', error);
  // Không tự reload ở đây để tránh vòng lặp và tránh ảnh hưởng dữ liệu người dùng.
});
