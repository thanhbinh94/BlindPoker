import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_KIT_VERSION } from './index.js'

describe('ui-kit test setup', () => {
  it('renders JSX under jsdom', () => {
    render(<span data-testid="v">{UI_KIT_VERSION}</span>)
    expect(screen.getByTestId('v')).toHaveTextContent('0.1.0')
  })
})
