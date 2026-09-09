import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Star, Trash2, Save } from 'lucide-react';
import type { TripProfile } from '@kfr/core';
import { api, ApiError, type TripProfileInput } from '../api/client';
import { useInvalidate, useProfileDefaults, useProfiles } from '../api/hooks';
import { ProfileForm } from '../components/ProfileForm';
import { Card, Loading } from '../components/ui';
import { cabinLabel } from '../lib/format';

const toInput = (p: TripProfile): TripProfileInput => {
  const { id: _id, ...rest } = p;
  void _id;
  return rest;
};

export function ProfilesPage() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const profiles = useProfiles();
  const defaults = useProfileDefaults();
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState<TripProfileInput | null>(null);
  const [draftId, setDraftId] = useState<string | 'new' | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profiles.data) return;
    if (profileId === 'new') {
      if (draftId !== 'new' && defaults.data) {
        const { defaults: _d, ...rest } = defaults.data;
        void _d;
        setDraft(rest);
        setDraftId('new');
      }
      return;
    }
    const p = profiles.data.find((x) => x.id === profileId) ?? profiles.data.find((x) => x.isDefault) ?? profiles.data[0];
    if (p && p.id !== draftId) {
      setDraft(toInput(p));
      setDraftId(p.id);
      setStatus(null);
    }
  }, [profileId, profiles.data, defaults.data, draftId]);

  const save = async (): Promise<void> => {
    if (!draft || !draftId) return;
    setSaving(true);
    setStatus(null);
    try {
      if (draftId === 'new') {
        const created = await api.createProfile(draft);
        await invalidate(['profiles']);
        setDraftId(created.id);
        navigate(`/profiles/${created.id}`);
      } else {
        await api.updateProfile(draftId, draft);
        await invalidate(['profiles'], ['radar']);
      }
      setStatus({ kind: 'ok', text: 'Profile saved' });
    } catch (e) {
      const msg = e instanceof ApiError && e.issues ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e instanceof Error ? e.message : 'Save failed';
      setStatus({ kind: 'error', text: msg });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this profile?')) return;
    await api.deleteProfile(id);
    await invalidate(['profiles']);
    setDraftId(null);
    navigate('/profiles');
  };

  const makeDefault = async (id: string): Promise<void> => {
    await api.setDefaultProfile(id);
    await invalidate(['profiles'], ['radar']);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Profiles</h1>
          <p>Reusable trip profiles: dates, airports, hard constraints, flight-time preferences and scoring weights.</p>
        </div>
        <button className="btn primary" onClick={() => navigate('/profiles/new')} data-testid="profile-new">
          <Plus size={14} /> New profile
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '260px 1fr' }}>
        <Card title="Saved profiles" testId="profile-list">
          {profiles.isLoading && <Loading />}
          <div className="stack">
            {profiles.data?.map((p) => (
              <div key={p.id} className={`row between`} style={{ padding: '8px 10px', borderRadius: 8, background: draftId === p.id ? 'rgba(76,201,240,0.1)' : 'transparent', cursor: 'pointer' }} onClick={() => navigate(`/profiles/${p.id}`)} data-testid="profile-item">
                <div>
                  <div className="strong">
                    {p.name} {p.isDefault && <Star size={12} color="var(--c-warn)" />}
                  </div>
                  <div className="tiny muted">
                    {p.outboundEarliestDate} → {p.returnLatestDate} · {cabinLabel(p.longHaulCabin)} · {p.enabledOrigins.length} origins
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card
          title={draftId === 'new' ? 'New profile' : draft?.name ?? 'Profile'}
          testId="profile-editor"
          actions={
            draft && (
              <div className="row">
                {draftId && draftId !== 'new' && (
                  <>
                    <button className="btn sm" onClick={() => void makeDefault(draftId)} disabled={draft.isDefault} data-testid="profile-make-default">
                      <Star size={12} /> Make default
                    </button>
                    <button className="btn sm danger" onClick={() => void remove(draftId)} data-testid="profile-delete">
                      <Trash2 size={12} /> Delete
                    </button>
                  </>
                )}
                <button className="btn primary sm" onClick={() => void save()} disabled={saving} data-testid="profile-save">
                  <Save size={12} /> {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            )
          }
        >
          {status && (
            <p className={status.kind === 'ok' ? 'success' : 'error'} data-testid="profile-status" style={{ marginBottom: 10 }}>
              {status.text}
            </p>
          )}
          {draft ? <ProfileForm value={draft} onChange={setDraft} /> : <Loading />}
        </Card>
      </div>
    </div>
  );
}
