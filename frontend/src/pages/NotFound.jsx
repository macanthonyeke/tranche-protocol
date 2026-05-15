import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="card-surface p-12 text-center max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
      <p className="text-sm text-text-secondary mb-6">That page doesn't exist.</p>
      <Link to="/dashboard" className="btn-primary inline-flex">Back to dashboard</Link>
    </div>
  )
}
