// useConfirm — Promise-based confirmation hook so callers can write
// `const ok = await confirm({ title: 'Delete?', variant: 'danger' })`
// and replace browser confirm() one mechanical edit at a time.
//
// Usage:
//   const { confirm, modal } = useConfirm();
//   // render {modal} once near the root of your component
//   async function deleteThing() {
//     const ok = await confirm({ title: 'Delete', variant: 'danger' });
//     if (!ok) return;
//     ...
//   }
//
// One pending request at a time per hook instance. A second confirm()
// while one is pending replaces the first (the prior Promise resolves
// to false).

import { useCallback, useState, type ReactElement } from 'react';
import { ConfirmModal, type ConfirmModalProps } from '../components/ConfirmModal';

type Options = Omit<ConfirmModalProps, 'onConfirm' | 'onCancel'>;

interface PendingConfirm {
  options: Options;
  resolve: (ok: boolean) => void;
}

export function useConfirm(): {
  confirm: (opts: Options) => Promise<boolean>;
  modal: ReactElement | null;
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (opts: Options): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        setPending((prev) => {
          // Resolve any prior pending as false — we only show one modal
          // at a time per hook instance.
          if (prev) prev.resolve(false);
          return { options: opts, resolve };
        });
      });
    },
    [],
  );

  const close = useCallback((ok: boolean) => {
    setPending((p) => {
      if (p) p.resolve(ok);
      return null;
    });
  }, []);

  const modal = pending ? (
    <ConfirmModal
      {...pending.options}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return { confirm, modal };
}
