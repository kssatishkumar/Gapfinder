import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main className="wrap page gap-18">
      <h1 className="h-page">Page not found</h1>
      <p className="lead">That page doesn’t exist.</p>
      <Link to="/" className="btn btn-primary btn-md self-start">Go home</Link>
    </main>
  );
}
