export function telnyxErrorMessage(event) {
  return event?.error?.message
    || event?.message
    || event?.payload?.message
    || 'The web phone could not connect.';
}

export function reportWebVoiceError(operation, failure) {
  const error = failure instanceof Error ? failure : new Error(String(failure));
  console.error(`[Vocivo Web Voice] ${operation} failed`, {
    message: error.message,
    stack: error.stack,
  });
}
