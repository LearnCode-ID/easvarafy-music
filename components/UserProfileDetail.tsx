'use client';
import { ProfileView } from './ProfileView';
export function UserProfileDetail({ userId }: { userId: string }) {
  return <ProfileView key={userId} userId={userId} />;
}
