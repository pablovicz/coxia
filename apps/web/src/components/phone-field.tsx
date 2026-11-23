import { PhoneInput } from 'react-international-phone';
import 'react-international-phone/style.css';
import './phone-field.css';

/**
 * WhatsApp com seletor de país (padrão Brasil). O valor sai em E.164 ("+5511987654321"),
 * que a API entende como número com país.
 */
export function PhoneField({
  id,
  value,
  onChange,
  describedBy,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (phone: string) => void;
  describedBy?: string;
  invalid?: boolean;
}) {
  return (
    <PhoneInput
      className="coxia-phone"
      defaultCountry="br"
      preferredCountries={['br', 'pt', 'us', 'ar', 'es']}
      value={value}
      onChange={(phone) => onChange(phone)}
      inputProps={{ id, autoComplete: 'tel', 'aria-describedby': describedBy, 'aria-invalid': invalid || undefined }}
      countrySelectorStyleProps={{ buttonContentWrapperClassName: 'coxia-phone-flag' }}
    />
  );
}
