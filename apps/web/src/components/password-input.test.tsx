import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from '@coxia/ui/components/ui/password-input';

describe('PasswordInput', () => {
  it('mostra e oculta a senha digitada', async () => {
    render(
      <>
        <label htmlFor="p">Senha</label>
        <PasswordInput id="p" />
      </>,
    );
    const input = screen.getByLabelText('Senha', { selector: 'input' });
    await userEvent.type(input, 'segredo-123');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('segredo-123');
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(input).toHaveAttribute('type', 'password');
  });
});
