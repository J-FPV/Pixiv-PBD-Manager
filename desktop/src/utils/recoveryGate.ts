let locked = false;
let requests = 0;
export const isRecoveryLocked = () => locked;
export function beginRecovery() {
  if (locked || requests) throw new Error("Wait for active tasks and changes to finish before restoring or undoing.");
  locked = true;
  window.dispatchEvent(new Event("pbd-recovery-lock"));
}
export function endRecovery() {
  locked = false;
  window.dispatchEvent(new Event("pbd-recovery-lock"));
}
export function enterRequest(command: string) {
  if (locked && command !== "settings.get" && !command.startsWith("backup.") && !command.startsWith("history.") && !command.startsWith("file.")) {
    throw new Error("Data recovery is in progress; wait before making changes.");
  }
  requests += 1;
  return () => { requests -= 1; };
}
