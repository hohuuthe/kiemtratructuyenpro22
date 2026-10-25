// Dedicated route: POST /api/results/delete-by-exam
// Do not reuse the legacy DELETE /api/results?clearAll=true endpoint.
export { onRequestPostDeleteByExam as onRequestPost, onRequestOptions } from '../results';
