import React, {useState} from 'react';
import {BASE} from './data.js';
import Wordmark from './Wordmark.jsx';
import './sections.css';

// Mercado imobiliário vive dentro de Estatísticas de crédito; a atualização da base segue por endereço direto (?view=update).
export const APP_NAVIGATION = [
  ['institutions', 'Saúde das instituições financeiras'],
  ['sfn', 'Estatísticas de crédito'],
  ['payments', 'Estatísticas de pagamentos'],
];
export const navigationSection = page => page === 'imob' ? 'sfn' : page;

export default function AppShell({page, onNavigate, header, children}) {
  const [menuOpen, setMenuOpen] = useState(false);
  function navigate(event, destination) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setMenuOpen(false);
    onNavigate(destination);
  }
  return <div className="tc-workspace">
    <header className="tc-app-nav">
      <a className="tc-app-wordmark" href={BASE} onClick={event => navigate(event, 'overview')}><Wordmark subtitle={false}/></a>
      <button className="tc-app-menu" type="button" aria-expanded={menuOpen} aria-controls="tc-app-navigation" onClick={() => setMenuOpen(!menuOpen)}>Menu</button>
      <nav id="tc-app-navigation" className={menuOpen ? 'is-open' : ''} aria-label="Navegação principal">
        {APP_NAVIGATION.map(([id, label]) => <a key={id} href={`${BASE}?view=${id}`} aria-current={navigationSection(page) === id ? 'page' : undefined} onClick={event => navigate(event, id)}>{label}</a>)}
      </nav>
    </header>
    {header}
    <main className="tc-workspace-main">{children}</main>
    <footer className="tc-app-footer"><span>Atlas do dinheiro e patrimônio no território brasileiro</span><a href="/">matheusprat.es</a></footer>
  </div>;
}
