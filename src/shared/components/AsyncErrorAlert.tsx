export function AsyncErrorAlert({
  message,
  className = '',
}: {
  message: string | null;
  className?: string;
}) {
  if (!message) return null;

  return (
    <p role="alert" className={`text-sm text-danger-600 ${className}`}>
      {message}
    </p>
  );
}
