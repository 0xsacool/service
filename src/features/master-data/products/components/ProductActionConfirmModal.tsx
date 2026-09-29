import { AsyncErrorAlert, Modal, SecondaryButton } from '../../../../shared/components';

export function ProductActionConfirmModal({
  title,
  message,
  confirmLabel,
  destructive = false,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} preventClose={pending}>
      <p className="text-sm leading-6 text-neutral-600">{message}</p>
      <AsyncErrorAlert message={error} className="mt-4" />
      <div className="mt-6 flex justify-end gap-3">
        <SecondaryButton onClick={onClose} disabled={pending}>
          ยกเลิก
        </SecondaryButton>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={`rounded-full px-5 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
            destructive
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-brand-500 hover:bg-brand-600'
          }`}
        >
          {pending ? 'กำลังดำเนินการ…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
