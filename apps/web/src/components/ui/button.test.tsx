import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('asChild vira o próprio link, com o estilo do botão', () => {
    render(
      <MemoryRouter>
        <Button variant="outline" asChild>
          <Link to="/salas">Salas</Link>
        </Button>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Salas' });
    expect(link).toHaveAttribute('href', '/salas');
    expect(link.className).toContain('min-h-11');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('loading desabilita e mostra o indicador', () => {
    render(<Button loading>Salvar</Button>);
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });
});
