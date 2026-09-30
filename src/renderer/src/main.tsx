import './assets/main.css'
import './assets/specs.css'
import './assets/releases.css'
import './assets/release-app.css'
import './assets/roadmap-pool.css'
import './assets/commands.css'
import './assets/project-rail.css'
import './assets/handoffs.css'
import './assets/link-arrival.css'
import './assets/fleet.css'
import './assets/project-home.css'
import './assets/markup.css'
import './assets/get-started.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { forgetRetiredProjectSelections } from './lib/projectSidebar'

// The three per-surface project selections are retired, not migrated: the
// window scope is the only answer to "which project" (ADR-0016 § 1).
forgetRetiredProjectSelections()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
