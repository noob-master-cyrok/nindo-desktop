import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { SupabaseStore } from './data/supabaseStore';
import { TasksRepo } from './data/tasksRepo';
import { NotesRepo } from './data/notesRepo';
import { SignIn } from './ui/SignIn';
import { Workspace } from './ui/Workspace';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const repos = useMemo(() => {
    if (!supabase) return null;
    const store = new SupabaseStore(supabase);
    return { tasks: new TasksRepo({ store }), notes: new NotesRepo({ store }) };
  }, []);

  if (!supabase || !repos) {
    return (
      <main className="center">
        <div className="card narrow">
          <h1>Nindo Desktop</h1>
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
    <Workspace
      key={session.user.id}
      email={session.user.email ?? 'your account'}
      tasks={repos.tasks}
      notes={repos.notes}
      onSignOut={() => supabase!.auth.signOut()}
    />
  );
}
