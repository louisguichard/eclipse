/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Farewell, FarewellGate } from './Farewell'

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

afterEach(cleanup)

describe('Farewell', () => {
  it('states the end and the next appointment under the photograph', () => {
    render(<Farewell onEnter={() => {}} />)

    expect(screen.getByText('C’est terminé.')).toBeInTheDocument()
    expect(screen.getByText('Rendez-vous le 2 août 2027 !')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAccessibleName(/12 août 2026/)
  })

  it('credits the photographer', () => {
    render(<Farewell onEnter={() => {}} />)

    expect(screen.getByText(/Mahaut Colliaut/)).toBeInTheDocument()
  })

  // The print is the page; only one control leaves it, so a stray click or a
  // reflex Escape can never take the photograph away from a reader.
  it('leaves the print in place for anything but the button', () => {
    let entered = 0
    const { container } = render(<Farewell onEnter={() => { entered += 1 }} />)

    fireEvent.click(container.querySelector('.farewell') as HTMLElement)
    fireEvent.click(screen.getByRole('img'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(entered).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Revenir au site' }))
    expect(entered).toBe(1)
  })
})

describe('FarewellGate', () => {
  it('holds the application back until the visitor steps through', () => {
    render(<FarewellGate><p>Le site</p></FarewellGate>)

    expect(screen.queryByText('Le site')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revenir au site' }))

    expect(screen.getByText('Le site')).toBeInTheDocument()
  })

  // Nothing is written down, so the bare address is the print every time: the
  // stepping through belongs to that page load and to no other.
  it('meets the next bare visit with the photograph again', () => {
    const first = render(<FarewellGate><p>Le site</p></FarewellGate>)
    fireEvent.click(screen.getByRole('button', { name: 'Revenir au site' }))
    expect(screen.getByText('Le site')).toBeInTheDocument()
    first.unmount()

    render(<FarewellGate><p>Le site</p></FarewellGate>)
    expect(screen.getByText('C’est terminé.')).toBeInTheDocument()
    expect(screen.queryByText('Le site')).not.toBeInTheDocument()
  })

  // The query string is what says "already inside": a shared link, a debug
  // session, or the observer the app writes back into the URL as it is used.
  it.each([
    '/?lat=48.856614&lng=2.352222&time=62',
    '/?debug=true',
  ])('steps aside for %s', (url) => {
    window.history.replaceState(null, '', url)
    render(<FarewellGate><p>Le site</p></FarewellGate>)

    expect(screen.getByText('Le site')).toBeInTheDocument()
    expect(screen.queryByText('C’est terminé.')).not.toBeInTheDocument()
  })
})
