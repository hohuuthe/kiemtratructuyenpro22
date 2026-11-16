import { EXAM_HEARTBEAT_MS } from './exam-exit-policy.js';

let active = null;
let timer = null;
let lastLeaveSent = false;

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function sendActivity(action, keepalive = false) {
  if (!active || !active.token || (action === 'leave' && lastLeaveSent)) return;
  const {token, getAuthToken, getAnswers, getWriterId, getRevision}=active;
  const headers={'Content-Type':'application/json'};
  const auth=getAuthToken?.();
  if (auth) headers.Authorization='Bearer '+auth;
  const payload={token,action};
  if (action==='leave') {
    lastLeaveSent=true;
    // Keepalive requests have small body limits. Large essay images are
    // already protected by the normal autosave endpoint.
    try {
      const answers=getAnswers?.();
      if (Array.isArray(answers)) {
        const extra={studentAnswers:answers,writerId:getWriterId?.(),revision:getRevision?.()};
        if (JSON.stringify({...payload,...extra}).length<45_000) Object.assign(payload,extra);
      }
    } catch {}
  }
  try {
    void fetch('/api/exam/heartbeat',{
      method:'POST',headers,body:JSON.stringify(payload),
      keepalive,cache:'no-store'
    }).catch(()=>{});
  } catch {}
}

/**
 * Lifetime belongs to the current document only. Never persist a token,
 * answers, or recovery metadata in localStorage or sessionStorage.
 */
export function beginExamLifecycle(config) {
  stopTimer();
  active=config;
  lastLeaveSent=false;
  sendActivity('heartbeat');
  timer=setInterval(()=>sendActivity('heartbeat'),EXAM_HEARTBEAT_MS);
}

export function stopExamLifecycle() {
  stopTimer();
  active=null;
  lastLeaveSent=false;
}

export function leaveExamLifecycle() {
  stopTimer();
  sendActivity('leave',true);
  // This document is leaving. Do not resume it on navigation back.
  active=null;
}

// pagehide also fires for browser back/refresh/closing the tab.
// visibilitychange is NOT an exit signal and never submits the exam.
if (typeof window!=='undefined') {
  window.addEventListener('pagehide',()=>{
    leaveExamLifecycle();
  });
}
