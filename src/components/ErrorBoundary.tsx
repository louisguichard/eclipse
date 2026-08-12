import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { captureFatalError } from '../lib/sentry'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render failed', error, info)
    captureFatalError('react-render', error)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="fatal-error">
          <AlertTriangle size={28} />
          <h1>La simulation n’a pas pu démarrer.</h1>
          <p>Rechargez la page. Si le problème persiste, vérifiez votre connexion et la disponibilité des services de carte, de recherche et de panorama.</p>
          <button type="button" onClick={() => window.location.reload()}>Recharger</button>
        </main>
      )
    }
    return this.props.children
  }
}
