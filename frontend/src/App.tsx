import { ReactNode, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { chatClient } from './chat/chatClient';
import { AppLayout } from './components/AppLayout';
import { CatalogPage } from './pages/CatalogPage';
import { ChatPage } from './pages/ChatPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NewDirectPage } from './pages/NewDirectPage';
import { NewRoomPage } from './pages/NewRoomPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { useAuthStore } from './store/authStore';

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  return status === 'authenticated' ? <>{children}</> : <Navigate to="/login" replace />;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  return status === 'authenticated' ? <Navigate to="/" replace /> : <>{children}</>;
}

export default function App() {
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    void useAuthStore.getState().bootstrap();
  }, []);

  // Подключение к чату живёт, пока пользователь авторизован
  useEffect(() => {
    if (status === 'authenticated') {
      chatClient.start();
    } else {
      chatClient.stop();
    }
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="splash" role="status">
        Загрузка…
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestOnly>
            <LoginPage />
          </GuestOnly>
        }
      />
      <Route
        path="/register"
        element={
          <GuestOnly>
            <RegisterPage />
          </GuestOnly>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="rooms/new" element={<NewRoomPage />} />
        <Route path="dialogs/new" element={<NewDirectPage />} />
        <Route path="rooms/:roomId" element={<ChatPage />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
