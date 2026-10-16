import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './field';
import { Input } from './input';

describe('Field', () => {
  it('wires label, control and error message for assistive technology', () => {
    render(
      <Field label="Name" error="Required">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Required');
  });

  it('shows hints when there is no error', () => {
    render(
      <Field label="Code" hint="Short code">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('Code')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription('Short code');
  });
});
