/** The name of the pause where a material waits for you to finish reviewing its concepts. */
export function materialReviewToken(materialId: string): string {
  return `material:${materialId}:reviewed`;
}

/** The name of the pause where a session waits for your answers to one round. */
export function sessionAnswersToken(sessionId: string, round: number): string {
  return `session:${sessionId}:round:${round}`;
}

/** The name of the pause where a session waits for you to confirm what you missed. */
export function sessionReviewToken(sessionId: string): string {
  return `session:${sessionId}:review`;
}
