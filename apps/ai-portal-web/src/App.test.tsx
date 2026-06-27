// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the portal title', () => {
    render(<App />);
    expect(screen.getByText('AI/Agent Portal')).toBeTruthy();
  });
});
