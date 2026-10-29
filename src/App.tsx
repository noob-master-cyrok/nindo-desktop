import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { SupabaseStore } from './data/supabaseStore';
import { PlannerRepo } from './data/plannerRepo';
import { SignIn } from './ui/SignIn';
import { PlannerWorkspace } from './ui/PlannerWorkspace';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const planner = useMemo(() => (supabase ? new PlannerRepo({ store: new SupabaseStore(supabase) }) : null), []);

  if (!supabase || !planner) {
    return (
      <main className="center">
        <div className="card narrow">
          <h1 className="sheet-title">Nindo Tasks</h1>
          <p>
            This build has no server settings. Copy <code>.env.example</code> to <code>.env.local</code>, fill in the
            public URL and anon key, then rebuild.
          </p>
        </div>
      </main>
    );
  }
  if (session === undefined) return <main className="center muted">Loading…</main>;
  if (!session) return <SignIn client={supabase} />;
  return (
    <PlannerWorkspace
      key={session.user.id}
      email={session.user.email ?? 'your account'}
      planner={planner}
      onSignOut={() => supabase!.auth.signOut()}
    />
  );
}
