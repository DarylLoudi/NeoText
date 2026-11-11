// The signed-out pages, loaded on demand: a signed-in visit to the chat never downloads them.
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { AuthLayout } from '../../features/auth/AuthLayout';
import { LoginForm } from '../../features/auth/LoginForm';
import { RecoverForm } from '../../features/auth/RecoverForm';
import { RegisterForm } from '../../features/auth/RegisterForm';
import { SetupWizard } from '../../features/auth/SetupWizard';
import { useInstance } from '../../state/session';
import { beginSession, setSignedIn } from '../session-flow';
import { safeRedirect } from './redirect';

export function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { redirect } = useSearch({ from: '/login' });
  return (
    <AuthLayout>
      <LoginForm
        onSuccess={(user) => {
          beginSession(user, queryClient);
          setSignedIn(queryClient, user);
          router.history.push(safeRedirect(redirect));
        }}
      />
    </AuthLayout>
  );
}

export function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const instance = useInstance();
  return (
    <AuthLayout>
      <SetupWizard
        envProviderAvailable={instance.data?.envProviderAvailable ?? false}
        onDone={(user) => {
          setSignedIn(queryClient, user);
          void navigate({ to: '/' });
        }}
      />
    </AuthLayout>
  );
}

export function RecoverPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <AuthLayout>
      <RecoverForm
        onDone={(user) => {
          setSignedIn(queryClient, user);
          void navigate({ to: '/' });
        }}
      />
    </AuthLayout>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const instance = useInstance();
  // The route guard already sent closed instances to sign-in, so this is `invite` or `open`.
  const registration = instance.data?.registration === 'open' ? 'open' : 'invite';
  return (
    <AuthLayout>
      <RegisterForm
        registration={registration}
        onDone={(user) => {
          setSignedIn(queryClient, user);
          void navigate({ to: '/' });
        }}
      />
    </AuthLayout>
  );
}
