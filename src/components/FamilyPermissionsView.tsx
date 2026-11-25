import React, { useEffect, useState } from 'react';
import { Check, Copy, Phone, Plus, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import type { GranularPermissions, SharingLevel } from '../../shared/types.ts';
import { ApiError, apiRequest } from '../lib/api.ts';

interface FamilyLink {
  id: string;
  invite_code: string;
  relationship: string;
  sharing_level: SharingLevel;
  permissions: GranularPermissions;
  status: 'pending' | 'active' | 'revoked';
  caregiver_name: string | null;
  caregiver_email: string | null;
  caregiver_phone: string | null;
}

interface PermissionRequest {
  id: string;
  requested_level: SharingLevel;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  caregiver_name: string;
  caregiver_email: string;
  created_at: string;
}

interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  is_primary: number;
}

const PERMISSION_LABELS: Array<{ key: keyof GranularPermissions; label: string }> = [
  { key: 'checkin_status', label: 'Daily check-in completion status' },
  { key: 'checkin_responses', label: 'Daily check-in answers & notes' },
  { key: 'wellness_summaries', label: 'Weekly wellness summaries' },
  { key: 'safety_alerts', label: 'Safety & assistance alerts' },
  { key: 'scam_alerts', label: 'Scam warning alerts' },
  { key: 'reminder_status', label: 'Reminders & acknowledgement status' },
  { key: 'activity_summaries', label: 'Learning lesson & activity summaries' },
  { key: 'ai_summaries', label: 'High-level AI usage count (never private chat text)' },
  { key: 'contact_info', label: 'Phone number for quick calling' },
];

export function FamilyPermissionsView({ initialSection = 'permissions' }: { initialSection?: 'permissions' | 'call' }) {
  const [section, setSection] = useState<'permissions' | 'call'>(initialSection);
  const [links, setLinks] = useState<FamilyLink[]>([]);
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; action: string; actor_name: string; created_at: string }>>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);

  const [relationship, setRelationship] = useState('Daughter');
  const [inviteLevel, setInviteLevel] = useState<SharingLevel>('balanced');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [contactName, setContactName] = useState('');
  const [contactRel, setContactRel] = useState('Son');
  const [contactPhone, setContactPhone] = useState('');
  const [contactPrimary, setContactPrimary] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    try {
      const [permRes, contactRes] = await Promise.all([
        apiRequest<{
          links: FamilyLink[];
          requests: PermissionRequest[];
          history: Array<{ id: string; action: string; actor_name: string; created_at: string }>;
        }>('/api/permissions'),
        apiRequest<{ contacts: EmergencyContact[] }>('/api/senior/contacts'),
      ]);
      setLinks(permRes.links);
      setRequests(permRes.requests);
      setHistory(permRes.history);
      setContacts(contactRes.contacts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load family settings.');
    }
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/api/permissions/invite', {
        method: 'POST',
        body: { relationship, sharingLevel: inviteLevel },
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create invite code.');
    }
  }

  async function updateLinkLevel(linkId: string, sharingLevel: SharingLevel) {
    setError(null);
    try {
      await apiRequest(`/api/permissions/links/${linkId}`, {
        method: 'PUT',
        body: { sharingLevel },
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to update sharing level.');
    }
  }

  async function togglePermission(link: FamilyLink, key: keyof GranularPermissions) {
    setError(null);
    try {
      await apiRequest(`/api/permissions/links/${link.id}`, {
        method: 'PUT',
        body: { permissions: { [key]: !link.permissions[key] } },
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to update permission.');
    }
  }

  async function revokeLink(linkId: string) {
    setError(null);
    try {
      await apiRequest(`/api/permissions/links/${linkId}/revoke`, { method: 'POST' });
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to revoke family link.');
    }
  }

  async function respondRequest(requestId: string, decision: 'approved' | 'rejected') {
    setError(null);
    try {
      await apiRequest(`/api/permissions/requests/${requestId}/respond`, {
        method: 'POST',
        body: { decision },
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to respond to request.');
    }
  }

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ contacts: EmergencyContact[] }>('/api/senior/contacts', {
        method: 'POST',
        body: {
          name: contactName,
          relationship: contactRel,
          phone: contactPhone,
          isPrimary: contactPrimary,
        },
      });
      setContacts(res.contacts);
      setContactName('');
      setContactPhone('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save contact.');
    }
  }

  async function deleteContact(id: string) {
    setError(null);
    try {
      await apiRequest(`/api/senior/contacts/${id}`, { method: 'DELETE' });
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to remove contact.');
    }
  }

  function copyCode(code: string) {
    void navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  const pendingRequests = requests.filter((r) => r.status === 'pending');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Family &amp; Permission Centre</h1>
          <p className="text-slate-600 dark:text-slate-400">
            You stay in full control. Private AI conversations are never automatically shared.
          </p>
        </div>

        <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl self-start">
          <button
            type="button"
            onClick={() => setSection('permissions')}
            className={`min-h-[44px] px-4 rounded-xl font-semibold cursor-pointer ${
              section === 'permissions' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Sharing Permissions
          </button>
          <button
            type="button"
            onClick={() => setSection('call')}
            className={`min-h-[44px] px-4 rounded-xl font-semibold cursor-pointer ${
              section === 'call' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Call My Family
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 border border-red-300 text-red-900">
          {error}
        </div>
      )}

      {section === 'call' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <h2 className="font-display text-xl font-bold">Trusted Family &amp; Emergency Contacts</h2>
            {contacts.length === 0 ? (
              <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <p className="text-slate-600 dark:text-slate-400">
                  No family phone numbers added yet. Add a trusted family member on the right for one-tap calling.
                </p>
              </div>
            ) : (
              contacts.map((c) => (
                <div
                  key={c.id}
                  className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hc-surface"
                >
                  <div>
                    <h3 className="font-display text-xl font-bold">{c.name}</h3>
                    <p className="text-slate-600 dark:text-slate-400">
                      {c.relationship} · <span className="font-mono-nums">{c.phone}</span>
                      {c.is_primary ? ' · Primary' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`tel:${c.phone}`}
                      className="min-h-[50px] px-5 rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold inline-flex items-center gap-2"
                    >
                      <Phone className="w-5 h-5" />
                      <span>Call Now</span>
                    </a>
                    <button
                      type="button"
                      aria-label={`Remove ${c.name}`}
                      onClick={() => void deleteContact(c.id)}
                      className="min-h-[50px] min-w-[50px] rounded-2xl border border-slate-300 dark:border-slate-700 flex items-center justify-center hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={addContact}
            className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4 self-start"
          >
            <h2 className="font-display text-xl font-bold">Add Trusted Contact</h2>
            <div>
              <label htmlFor="c-name" className="block text-sm font-semibold mb-1">
                Name
              </label>
              <input
                id="c-name"
                required
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. Rohan Deshmukh"
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="c-rel" className="block text-sm font-semibold mb-1">
                Relationship
              </label>
              <input
                id="c-rel"
                required
                value={contactRel}
                onChange={(e) => setContactRel(e.target.value)}
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="c-phone" className="block text-sm font-semibold mb-1">
                Phone Number
              </label>
              <input
                id="c-phone"
                type="tel"
                required
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Include country code starting with +"
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <label className="flex items-center gap-2 min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                checked={contactPrimary}
                onChange={(e) => setContactPrimary(e.target.checked)}
                className="w-5 h-5"
              />
              <span>Set as primary quick-call contact</span>
            </label>
            <button
              type="submit"
              className="w-full min-h-[50px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              <span>Save Contact</span>
            </button>
          </form>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending Sharing Requests from Caregivers */}
          {pendingRequests.length > 0 && (
            <div className="p-6 rounded-3xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-500 space-y-4">
              <h2 className="font-display text-xl font-bold">Pending Family Sharing Requests</h2>
              {pendingRequests.map((reqItem) => (
                <div
                  key={reqItem.id}
                  className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <p className="font-bold">
                      {reqItem.caregiver_name} ({reqItem.caregiver_email}) requested <span className="capitalize">{reqItem.requested_level}</span> access
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Reason: {reqItem.reason}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void respondRequest(reqItem.id, 'approved')}
                      className="min-h-[44px] px-4 rounded-xl bg-[#0F5156] text-white font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Approve</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void respondRequest(reqItem.id, 'rejected')}
                      className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>Decline</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create Invite Code */}
          <form
            onSubmit={createInvite}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface flex flex-col md:flex-row md:items-end gap-4"
          >
            <div className="flex-1">
              <label htmlFor="invite-rel" className="block text-sm font-semibold mb-1">
                Family Member Relationship
              </label>
              <input
                id="invite-rel"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="invite-lvl" className="block text-sm font-semibold mb-1">
                Initial Sharing Level
              </label>
              <select
                id="invite-lvl"
                value={inviteLevel}
                onChange={(e) => setInviteLevel(e.target.value as SharingLevel)}
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="minimal">Minimal (Basic safety &amp; check-in status)</option>
                <option value="balanced">Balanced (Check-ins, alerts &amp; reminders)</option>
                <option value="full">Full (All wellness &amp; activity summaries)</option>
              </select>
            </div>
            <button
              type="submit"
              className="min-h-[48px] px-6 rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <UserPlus className="w-5 h-5" />
              <span>Create Invite Code</span>
            </button>
          </form>

          {/* Linked & Pending Caregivers */}
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold">Authorized Family Members &amp; Invites</h2>
            {links.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400">
                No family members invited yet. Create an invite code above to connect a caregiver.
              </p>
            ) : (
              links.map((link) => (
                <div
                  key={link.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-[#0F5156] dark:text-teal-400" />
                        <h3 className="font-display text-lg font-bold">
                          {link.caregiver_name ? `${link.caregiver_name} (${link.relationship})` : `Pending Invite (${link.relationship})`}
                        </h3>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Status: <span className="font-semibold capitalize">{link.status}</span> · Invite Code:{' '}
                        <span className="font-mono-nums font-bold">{link.invite_code}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {link.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => copyCode(link.invite_code)}
                          className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Copy className="w-4 h-4" />
                          <span>{copiedCode === link.invite_code ? 'Copied' : 'Copy Code'}</span>
                        </button>
                      )}
                      {link.status !== 'revoked' && (
                        <button
                          type="button"
                          onClick={() => void revokeLink(link.id)}
                          className="min-h-[44px] px-4 rounded-xl border border-red-300 text-red-700 dark:text-red-400 font-semibold cursor-pointer"
                        >
                          Revoke Access
                        </button>
                      )}
                    </div>
                  </div>

                  {link.status !== 'revoked' && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {(['minimal', 'balanced', 'full'] as SharingLevel[]).map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => void updateLinkLevel(link.id, lvl)}
                            className={`min-h-[44px] px-4 rounded-xl border-2 font-semibold capitalize cursor-pointer ${
                              link.sharing_level === lvl
                                ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                                : 'border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {lvl}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2">
                        {PERMISSION_LABELS.map((item) => (
                          <label
                            key={item.key}
                            className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer min-h-[48px]"
                          >
                            <input
                              type="checkbox"
                              checked={link.permissions[item.key]}
                              onChange={() => void togglePermission(link, item.key)}
                              className="w-5 h-5 accent-[#0F5156]"
                            />
                            <span className="text-sm font-medium">{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          {history.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-3">
              <h2 className="font-display text-lg font-bold">Permission Change History</h2>
              <div className="space-y-2 max-h-48 overflow-y-auto text-sm">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                    <span>
                      {h.actor_name} · {h.action}
                    </span>
                    <span className="font-mono-nums text-slate-500">
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
