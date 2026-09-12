import AppRoutes from './routes'
import MaintenanceGate from '@food/components/MaintenanceGate'

function App() {
  // Wraps everything so any surface hits the notice, not just the customer app.
  // The gate stands aside on /admin paths, so maintenance mode can always be
  // switched back off.
  return (
    <MaintenanceGate>
      <AppRoutes />
    </MaintenanceGate>
  )
}

export default App
