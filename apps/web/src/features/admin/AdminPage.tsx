import { Navigate, useParams } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { useSession } from '../../state/session';
import { AdminLayout, type AdminSection, isAdminSection } from './AdminLayout';
import { AuditPage } from './AuditPage';
import { InstancePage } from './InstancePage';
import { InvitesPage } from './InvitesPage';
import { UsersPage } from './UsersPage';

const PAGES: Record<AdminSection, ComponentType> = {
  users: UsersPage,
  invites: InvitesPage,
  instance: InstancePage,
  audit: AuditPage,
};

/** The admin area. The route loads this file on demand; members are sent back to the chat. */
export function AdminPage() {
  const { section } = useParams({ strict: false });
  const user = useSession().data;
  if (!user) return null;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  if (!section || !isAdminSection(section)) {
    return <Navigate to="/admin/$section" params={{ section: 'users' }} replace />;
  }
  const Page = PAGES[section];
  return (
    <AdminLayout>
      <Page />
    </AdminLayout>
  );
}
