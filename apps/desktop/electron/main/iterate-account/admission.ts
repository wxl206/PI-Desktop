/**
 * Serializes local turn admission with account-changing operations.
 *
 * A prompt holds the gate only until Main records its active turn. Account
 * changes hold it for their provider and journal mutations. Whichever side
 * starts second therefore observes the other's committed state.
 */
export class AccountAdmission {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => held);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }
}

/**
 * Acquires both admissions in the only order allowed by Main.
 *
 * Prompt admission and approved-plan dispatch both need the account and
 * per-session gates. Keeping the order in one place prevents a lock cycle if
 * either caller changes while a plan and prompt contend for the same session.
 */
export async function acquireAccountThenSession(
  acquireAccount: () => Promise<() => void>,
  acquireSession: () => Promise<() => void>,
): Promise<{ account: () => void; session: () => void }> {
  const releaseAccount = await acquireAccount();
  try {
    return { account: releaseAccount, session: await acquireSession() };
  } catch (error) {
    releaseAccount();
    throw error;
  }
}
