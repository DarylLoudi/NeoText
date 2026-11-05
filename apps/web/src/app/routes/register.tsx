import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { AuthLayout } from '../../features/auth/AuthLayout';
import { RegisterForm } from '../../features/auth/RegisterForm';
import { useInstance } from '../../state/session';
import { setSignedIn } from '../session-flow';
import { rootRoute } from './root';

function RegisterPage() {
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

export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
});
