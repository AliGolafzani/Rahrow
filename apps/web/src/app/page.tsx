import { AuthProvider, AuthNavigation } from '../components/auth';

export default function HomePage() {
  return (
    <main>
      <AuthProvider><AuthNavigation /></AuthProvider>
      <h1>Rahrow</h1>
      <p>Application skeleton. Product features are not implemented.</p>
    </main>
  );
}
