/**
 * In-process capability: never read this marker from an HTTP header, body,
 * cookie or JWT. Only the server-side finalizer can pass it to the grader.
 */
export const INTERNAL_EXAM_FINALIZER: unique symbol = Symbol('trusted-exam-finalizer');
