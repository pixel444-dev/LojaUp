import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider, ConfirmProvider } from './components/ui';
import './styles.css';

// Evita tela em branco caso alguma tela falhe
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="login-page">
        <div className="card login-card">
          <h1>Ops, algo deu errado nesta tela</h1>
          <div className="alert alert-danger mt mono small">{String(this.state.error.message || this.state.error)}</div>
          <button className="btn btn-primary btn-block mt" onClick={() => { this.setState({ error: null }); window.location.hash = '#/'; }}>Voltar ao início</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <HashRouter>
    <ToastProvider>
      <ConfirmProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ConfirmProvider>
    </ToastProvider>
  </HashRouter>,
);
