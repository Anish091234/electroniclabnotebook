import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./Dashboard.css";
import "./Team.css";
import type { LabInvite, LabMember, LabRole } from "../data/accountTypes";
import { useAuth } from "../contexts/AuthContext";
import {
  cancelLabInvite,
  createLabInvite,
  subscribeLabInvites,
  subscribeLabMembers,
} from "../services/accountService";

type InviteRole = Exclude<LabRole, "owner">;

const INVITE_ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: "researcher", label: "Researcher" },
  { value: "pi", label: "PI" },
  { value: "admin", label: "Admin" },
  { value: "viewer", label: "Viewer" },
  { value: "external", label: "External Collaborator" },
];

const EMPTY_INVITE_FORM = {
  email: "",
  displayName: "",
  role: "researcher" as InviteRole,
  piUid: "",
};

export function Team() {
  const { activeLab, activeMember, user } = useAuth();
  const [members, setMembers] = useState<LabMember[]>([]);
  const [invites, setInvites] = useState<LabInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInvitesLoading, setIsInvitesLoading] = useState(true);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isInviteSubmitting, setIsInviteSubmitting] = useState(false);
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE_FORM);

  const canManageInvites = activeMember?.role === "owner" || activeMember?.role === "admin";

  useEffect(() => {
    if (!activeLab) {
      setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);
    return subscribeLabMembers(
      activeLab.id,
      (nextMembers) => {
        setMembers(nextMembers);
        setError(null);
        setIsLoading(false);
      },
      (err) => {
        setError(err.message);
        setIsLoading(false);
      },
    );
  }, [activeLab]);

  useEffect(() => {
    if (!activeLab || !canManageInvites) {
      setInvites([]);
      setIsInvitesLoading(false);
      return undefined;
    }

    setIsInvitesLoading(true);
    return subscribeLabInvites(
      activeLab.id,
      (nextInvites) => {
        setInvites(nextInvites);
        setInviteError(null);
        setIsInvitesLoading(false);
      },
      (err) => {
        setInviteError(err.message);
        setIsInvitesLoading(false);
      },
    );
  }, [activeLab, canManageInvites]);

  const piMembers = useMemo(
    () => members.filter((member) => member.role === "owner" || member.role === "pi"),
    [members],
  );

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === "pending"),
    [invites],
  );

  const piGroups = useMemo(() => {
    const researchers = members.filter((member) => member.role === "researcher");
    const pendingResearchers = pendingInvites.filter((invite) => invite.role === "researcher");

    return piMembers.map((pi) => ({
      pi,
      researchers: researchers.filter((researcher) => researcher.piUid === pi.uid),
      pendingResearchers: pendingResearchers.filter((invite) => invite.piUid === pi.uid),
    }));
  }, [members, pendingInvites, piMembers]);

  const unassignedResearchers = useMemo(
    () => members.filter((member) => member.role === "researcher" && !member.piUid),
    [members],
  );

  const openInviteModal = (role: InviteRole = "researcher") => {
    setInviteError(null);
    setInviteForm({
      ...EMPTY_INVITE_FORM,
      role,
      piUid: role === "researcher" ? piMembers[0]?.uid ?? "" : "",
    });
    setIsInviteOpen(true);
  };

  const closeInviteModal = () => {
    setIsInviteOpen(false);
    setInviteForm(EMPTY_INVITE_FORM);
    setIsInviteSubmitting(false);
  };

  const updateInviteField = (field: keyof typeof inviteForm, value: string) => {
    setInviteForm((prev) => ({
      ...prev,
      [field]: value,
      ...(field === "role" && value !== "researcher" ? { piUid: "" } : {}),
      ...(field === "role" && value === "researcher" && !prev.piUid ? { piUid: piMembers[0]?.uid ?? "" } : {}),
    }));
  };

  const submitInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeLab || !user) return;

    if (inviteForm.role === "researcher" && !inviteForm.piUid) {
      setInviteError("Choose a PI for this researcher.");
      return;
    }

    setInviteError(null);
    setIsInviteSubmitting(true);

    try {
      await createLabInvite({
        labId: activeLab.id,
        labName: activeLab.name,
        email: inviteForm.email,
        displayName: inviteForm.displayName,
        role: inviteForm.role,
        piUid: inviteForm.piUid || null,
        invitedByUid: user.uid,
        invitedByName: user.name,
        appOrigin: window.location.origin,
      });
      closeInviteModal();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to create invite");
      setIsInviteSubmitting(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!activeLab) return;
    await cancelLabInvite(activeLab.id, inviteId);
  };

  const inviteUrlFor = (invite: LabInvite) => {
    if (!activeLab) return invite.inviteUrl;
    const url = new URL(invite.inviteUrl || `${window.location.origin}/login`);
    url.searchParams.set("invite", invite.token);
    url.searchParams.set("inviteId", invite.id);
    url.searchParams.set("labId", activeLab.id);
    return url.toString();
  };

  const openInviteEmail = (invite: LabInvite) => {
    if (!activeLab || !user) return;
    const role = roleLabel(invite.role).toLowerCase();
    const subject = `${user.name} invited you to ${activeLab.name} on LabOS`;
    const body = [
      `Hi ${invite.displayName},`,
      "",
      `${user.name} invited you to join ${activeLab.name} as a ${role}.`,
      "",
      `Accept the invite here: ${inviteUrlFor(invite)}`,
      "",
      "If you were not expecting this invite, you can ignore this email.",
    ].join("\n");

    window.location.href = `mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <>
      <div className="topbar">
        <h1>Team</h1>
        <div className="topbar-actions">
          <button className="btn-secondary" disabled={!canManageInvites} onClick={() => openInviteModal("researcher")}>
            Invite User
          </button>
          <button className="btn-primary" disabled={!canManageInvites} onClick={() => openInviteModal("pi")}>
            Add PI
          </button>
        </div>
      </div>

      <div className="team-content">
        <section className="team-lab-header">
          <div>
            <span className="team-kicker">Current Lab</span>
            <h2>{activeLab?.name ?? "No lab selected"}</h2>
            <p>
              Signed in role: <strong>{activeMember?.role ?? "unknown"}</strong>
            </p>
          </div>
          <div className="team-lab-stats">
            <div>
              <strong>{members.length}</strong>
              <span>Members</span>
            </div>
            <div>
              <strong>{piGroups.length}</strong>
              <span>PIs</span>
            </div>
            <div>
              <strong>{pendingInvites.length}</strong>
              <span>Pending</span>
            </div>
          </div>
        </section>

        {!canManageInvites && !isLoading && (
          <div className="team-empty">Only lab owners and admins can invite users right now.</div>
        )}

        {isLoading && <div className="team-empty">Loading lab accounts...</div>}
        {error && <div className="team-error">{error}</div>}
        {inviteError && !isInviteOpen && <div className="team-error">{inviteError}</div>}

        {!isLoading && !error && (
          <>
            <section className="team-section">
              <div className="team-section-header">
                <h2>PI Groups</h2>
                <p>Researchers are grouped under their assigned principal investigator.</p>
              </div>

              <div className="pi-group-grid">
                {piGroups.map(({ pi, researchers, pendingResearchers }) => (
                  <article key={pi.uid} className="pi-group-card">
                    <div className="team-person-row">
                      <div className="team-avatar">{initialsFor(pi)}</div>
                      <div>
                        <h3>{pi.displayName}</h3>
                        <span>{roleLabel(pi.role)}</span>
                      </div>
                    </div>

                    <div className="researcher-list">
                      {researchers.length === 0 && pendingResearchers.length === 0 && <p>No researchers assigned yet.</p>}
                      {researchers.map((researcher) => (
                        <div key={researcher.uid} className="researcher-row">
                          <span>{researcher.displayName}</span>
                          <small>{researcher.email}</small>
                        </div>
                      ))}
                      {pendingResearchers.map((invite) => (
                        <div key={invite.id} className="researcher-row pending">
                          <span>{invite.displayName}</span>
                          <small>{invite.email} - invited</small>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}

                {unassignedResearchers.length > 0 && (
                  <article className="pi-group-card">
                    <div className="team-person-row">
                      <div className="team-avatar muted">--</div>
                      <div>
                        <h3>Unassigned</h3>
                        <span>Needs PI assignment</span>
                      </div>
                    </div>
                    <div className="researcher-list">
                      {unassignedResearchers.map((researcher) => (
                        <div key={researcher.uid} className="researcher-row">
                          <span>{researcher.displayName}</span>
                          <small>{researcher.email}</small>
                        </div>
                      ))}
                    </div>
                  </article>
                )}
              </div>
            </section>

            {canManageInvites && (
              <section className="team-section">
                <div className="team-section-header">
                  <h2>Pending Invites</h2>
                  <p>Invites are stored at labs/{activeLab?.id}/invites.</p>
                </div>

                <div className="invite-list">
                  {isInvitesLoading && <div className="team-empty">Loading invites...</div>}
                  {!isInvitesLoading && pendingInvites.length === 0 && (
                    <div className="team-empty">No pending invites yet.</div>
                  )}
                  {pendingInvites.map((invite) => (
                    <article key={invite.id} className="invite-card">
                      <div>
                        <h3>{invite.displayName}</h3>
                        <p>{invite.email}</p>
                      </div>
                      <span className="invite-role-pill">{roleLabel(invite.role)}</span>
                      <span className="invite-meta">{invite.role === "researcher" ? piNameFor(invite.piUid, members) : "Lab-wide"}</span>
                      <button
                        className="invite-cancel-btn"
                        onClick={() => navigator.clipboard.writeText(inviteUrlFor(invite))}
                      >
                        Copy Link
                      </button>
                      <button className="invite-cancel-btn" onClick={() => openInviteEmail(invite)}>
                        Email Invite
                      </button>
                      <button className="invite-cancel-btn" onClick={() => handleCancelInvite(invite.id)}>
                        Cancel
                      </button>
                      <small className="invite-email-state">
                        Spark-safe invite link. Use Email Invite or Copy Link.
                      </small>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="team-section">
              <div className="team-section-header">
                <h2>All Lab Accounts</h2>
                <p>This list comes from Firestore at labs/{activeLab?.id}/members.</p>
              </div>

              <div className="team-table-wrap">
                <table className="team-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>PI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.uid}>
                        <td>
                          <div className="team-person-row compact">
                            <div className="team-avatar">{initialsFor(member)}</div>
                            <span>{member.displayName}</span>
                          </div>
                        </td>
                        <td>{member.email}</td>
                        <td>{roleLabel(member.role)}</td>
                        <td>{member.status}</td>
                        <td>{piNameFor(member.piUid, members)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {isInviteOpen && (
        <div className="modal-backdrop" onMouseDown={closeInviteModal}>
          <form className="team-invite-modal" onSubmit={submitInvite} onMouseDown={(e) => e.stopPropagation()}>
            <div className="experiment-modal-header">
              <div>
                <h2>Invite User</h2>
                <p>Add a PI, admin, or researcher to {activeLab?.name}.</p>
              </div>
              <button type="button" className="modal-close" onClick={closeInviteModal}>
                x
              </button>
            </div>

            {inviteError && <div className="team-error compact">{inviteError}</div>}

            <label className="modal-field">
              <span>Email</span>
              <input
                type="email"
                value={inviteForm.email}
                onChange={(e) => updateInviteField("email", e.target.value)}
                placeholder="researcher@university.edu"
                required
              />
            </label>

            <label className="modal-field">
              <span>Name</span>
              <input
                value={inviteForm.displayName}
                onChange={(e) => updateInviteField("displayName", e.target.value)}
                placeholder="Dr. Maya Patel"
              />
            </label>

            <label className="modal-field">
              <span>Role</span>
              <select value={inviteForm.role} onChange={(e) => updateInviteField("role", e.target.value)}>
                {INVITE_ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {inviteForm.role === "researcher" && (
              <label className="modal-field">
                <span>Assigned PI</span>
                <select
                  value={inviteForm.piUid}
                  onChange={(e) => updateInviteField("piUid", e.target.value)}
                  required
                >
                  {piMembers.map((pi) => (
                    <option key={pi.uid} value={pi.uid}>
                      {pi.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="team-invite-note">
              This creates a pending invite link. On Firebase Spark, use Email Invite or Copy Link to send it without Cloud Functions.
            </div>

            <div className="experiment-modal-actions">
              <button type="button" className="btn-secondary" onClick={closeInviteModal}>
                Cancel
              </button>
              <button className="btn-primary" type="submit" disabled={isInviteSubmitting}>
                {isInviteSubmitting ? "Creating..." : "Create Invite"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function initialsFor(member: LabMember) {
  const parts = member.displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return member.email.slice(0, 2).toUpperCase();
}

function roleLabel(role: LabMember["role"] | LabInvite["role"]) {
  if (role === "owner") return "Owner / PI";
  if (role === "pi") return "PI";
  if (role === "admin") return "Admin";
  if (role === "viewer") return "Viewer";
  if (role === "external") return "External Collaborator";
  return "Researcher";
}

function piNameFor(piUid: string | null, members: LabMember[]) {
  if (!piUid) return "Unassigned";
  return members.find((member) => member.uid === piUid)?.displayName ?? "Unknown PI";
}
