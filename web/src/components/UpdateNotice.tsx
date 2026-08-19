/**
 * One line, once, when there is a newer version.
 *
 * It is a notice and not an updater: the link opens GitHub's release page in the system browser
 * and the person decides. Replacing a running program's own binary from the internet is a
 * different feature with a different threat model — it wants code signing before it wants a
 * button — and the honest version of this feature is the one that tells you and gets out of
 * the way.
 *
 * Which is also why it can be dismissed. See lib/update.ts for why the dismissal is per version.
 */

import { useState } from 'react';
import {
  displayVersion,
  readDismissed,
  shouldShowUpdate,
  writeDismissed,
  type UpdateInfo,
} from '../lib/update.ts';

export function UpdateNotice({ update }: { update: UpdateInfo | undefined }) {
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed());

  if (!shouldShowUpdate(update, dismissed)) return null;
  // Narrowed by shouldShowUpdate: it returns false unless both of these are present.
  const latest = update?.latest as string;
  const url = update?.url as string;

  const dismiss = (): void => {
    writeDismissed(latest);
    setDismissed(latest);
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-accent-600/40 bg-accent-600/10 px-3 py-2 text-xs text-ink-200">
      <span>
        <span className="text-accent-400">What Remains {displayVersion(latest)}</span> is out — you
        are running {displayVersion(update?.current ?? '')}.
      </span>
      {/* target=_blank is what the desktop shell's window-open handler turns into "open this in
          the system browser"; in a tab it is an ordinary new tab. */}
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="rounded border border-accent-600/50 px-2 py-0.5 text-accent-400 transition-colors hover:border-accent-500 hover:text-accent-500"
      >
        release notes ↗
      </a>
      <button
        type="button"
        onClick={dismiss}
        className="ml-auto text-ink-400 transition-colors hover:text-ink-200"
        title="Hide this until the next release"
      >
        dismiss
      </button>
    </div>
  );
}
