import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AccountProvider } from './state/account';
import { WorkspaceProvider } from './state/workspace';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AccountProvider>
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </AccountProvider>
    </BrowserRouter>
  </StrictMode>,
);
