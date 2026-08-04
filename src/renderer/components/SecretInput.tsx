import { useState } from 'react';

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  className?: string;
  'aria-label'?: string;
}

/** Ô secret có nút mắt ẩn/hiện để copy/share. */
export default function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  autoComplete = 'off',
  className,
  'aria-label': ariaLabel,
}: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`secret-input ${className || ''}`.trim()}>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="secret-eye"
        disabled={disabled}
        title={visible ? 'Ẩn key' : 'Hiện key'}
        aria-label={visible ? 'Ẩn key' : 'Hiện key'}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? 'Ẩn' : 'Hiện'}
      </button>
    </div>
  );
}
