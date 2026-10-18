import { assessmentTimeRemaining, assessmentWorkerContext, continueAssessment } from '../../scripts/lib/assessment-worker.ts';

export const description = 'Continues an explicitly armed Good Brief assessment from validated disk checkpoints until completion or a bounded failure.';

export default function (amp) {
  const root = amp.system.workspaceRoot ? amp.helpers.filePathFromURI(amp.system.workspaceRoot) : null;
  if (!root) return;
  const timers = new Map();
  amp.on('agent.start', async (event, ctx) => {
    const remaining = assessmentTimeRemaining(root, event.thread.id);
    if (remaining === undefined) return;
    clearTimeout(timers.get(event.thread.id));
    if (!remaining) {
      await ctx.thread.cancel();
      return;
    }
    timers.set(event.thread.id, setTimeout(() => {
      ctx.thread.cancel().catch(error => ctx.logger.error('Assessment deadline cancellation failed', error));
    }, remaining));
    return { message: { content: assessmentWorkerContext(root, event.thread.id) } };
  });
  amp.on('agent.end', (event, ctx) => {
    clearTimeout(timers.get(event.thread.id));
    timers.delete(event.thread.id);
    try {
      return continueAssessment(root, event);
    } catch (error) {
      ctx.logger.error('Assessment continuation failed closed', error);
      throw error;
    }
  });
  amp.onDispose(() => {
    for (const timer of timers.values()) clearTimeout(timer);
  });
}
