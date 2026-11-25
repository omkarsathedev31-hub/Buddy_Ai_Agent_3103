import { AdminDashboard } from './components/AdminDashboard.tsx';
import { AuthOnboarding } from './components/AuthOnboarding.tsx';
import { BrandMark } from './components/BrandMark.tsx';
import { CaregiverDashboard } from './components/CaregiverDashboard.tsx';
import { SeniorDashboard } from './components/SeniorDashboard.tsx';
import { AppProvider, useApp } from './contexts/AppContext.tsx';

function RootRouter() {
  const { user, loading } = useApp();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] dark:bg-slate-950 flex flex-col items-center justify-center gap-3">
        <BrandMark className="w-12 h-12" />
        <p className="font-display text-lg font-semibold text-slate-700 dark:text-slate-300">
          Loading Buddy Elder AI...
        </p>
      </div>
    );
  }

  if (!user) {
    return <AuthOnboarding />;
  }

  if (user.role === 'admin') {
    return <AdminDashboard />;
  }

  if (user.role === 'caregiver') {
    return <CaregiverDashboard />;
  }

  return <SeniorDashboard />;
}

export default function App() {
  return (
    <AppProvider>
      <RootRouter />
    </AppProvider>
  );
}
