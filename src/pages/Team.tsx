import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./Dashboard.css";
import "./Team.css";
import type { LabInvite, LabMember, LabOwnershipTransfer, LabRole } from "../data/accountTypes";
import { useAuth } from "../contexts/AuthContext";
import {
  acceptLabOwnershipTransfer,
  cancelLabInvite,
  cancelLabOwnershipTransfer,
  createLabInvite,
  declineLabOwnershipTransfer,
  initiateLabOwnershipTransfer,
  subscribeLabInvites,
  subscribeLabMembers,
  subscribeLabOwnershipTransfers,
  updateLabMember,
} from "../services/accountService";

type InviteRole = Exclude<LabRole, "owner" | "external">;
type AssignableMemberRole = Exclude<LabRole, "owner" | "external">;

const INVITE_ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: "researcher", label: "Researcher" },
  { value: "pi", label: "PI" },
  { value: "admin", label: "Admin" },
  { value: "viewer", label: "Viewer" },
];

const MEMBER_ROLE_OPTIONS: { value: AssignableMemberRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "pi", label: "PI" },
  { value: "researcher", label: "Researcher" },
  { value: "viewer", label: "Viewer" },
];

const EMPTY_INVITE_FORM = {
  email: "",
  displayName: "",
  role: "researcher" as InviteRole,
  piUid: "",
};

type InviteMode = "user" | "pi";

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
  const [cancelingInviteId, setCancelingInviteId] = useState<string | null>(null);
  const [emailPreview, setEmailPreview] = useState<{ to: string; subject: string; body: string; inviteUrl: string } | null>(null);
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE_FORM);
  const [inviteMode, setInviteMode] = useState<InviteMode>("user");
  const [ownershipTransfers, setOwnershipTransfers] = useState<LabOwnershipTransfer[]>([]);
  const [ownershipError, setOwnershipError] = useState<string | null>(null);
  const [ownershipTarget, setOwnershipTarget] = useState<LabMember | null>(null);
  const [ownershipConfirmationEmail, setOwnershipConfirmationEmail] = useState("");
  const [isOwnershipSubmitting, setIsOwnershipSubmitting] = useState(false);
  const [ownershipActionId, setOwnershipActionId] = useState<string | null>(null);

  const canManageInvites = activeMember?.role === "owner" || activeMember?.role === "admin";
  const canInvitePrivileged = activeMember?.role === "owner";
  const canManageAccounts = activeMember?.role === "owner";

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

  useEffect(() => {
    if (!activeLab || !activeMember) {
      setOwnershipTransfers([]);
      return undefined;
    }

    return subscribeLabOwnershipTransfers(
      activeLab.id,
      activeMember.uid,
      (nextTransfers) => {
        setOwnershipTransfers(nextTransfers);
        setOwnershipError(null);
      },
      (err) => setOwnershipError(err.message),
    );
  }, [activeLab, activeMember]);

  const piMembers = useMemo(
    () => members.filter((member) => member.role === "owner" || member.role === "pi"),
    [members],
  );

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === "pending"),
    [invites],
  );

  const pendingPiInvites = useMemo(
    () => pendingInvites.filter((invite) => invite.role === "pi"),
    [pendingInvites],
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

  const pendingOwnershipTransfers = useMemo(
    () => ownershipTransfers.filter((transfer) => transfer.status === "pending"),
    [ownershipTransfers],
  );

  const outgoingOwnershipTransfer = useMemo(
    () => pendingOwnershipTransfers.find((transfer) => transfer.initiatedByUid === activeMember?.uid) ?? null,
    [activeMember?.uid, pendingOwnershipTransfers],
  );

  const incomingOwnershipTransfer = useMemo(
    () => pendingOwnershipTransfers.find((transfer) => transfer.targetUid === activeMember?.uid) ?? null,
    [activeMember?.uid, pendingOwnershipTransfers],
  );

  const openInviteModal = (role: InviteRole = "researcher") => {
    if ((role === "pi" || role === "admin") && !canInvitePrivileged) return;
    setInviteError(null);
    setInviteMode(role === "pi" ? "pi" : "user");
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
    setInviteMode("user");
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
    if (["admin", "pi"].includes(inviteForm.role) && !canInvitePrivileged) {
      setInviteError("Only the lab owner can issue admin or PI invites.");
      return;
    }

    setInviteError(null);
    setIsInviteSubmitting(true);

    try {
      const createdInvite = await createLabInvite({
        labId: activeLab.id,
        email: inviteForm.email,
        displayName: inviteForm.displayName,
        role: inviteForm.role,
        piUid: inviteForm.piUid || null,
      });
      closeInviteModal();
      const email = inviteEmailFor(createdInvite.invite, createdInvite.inviteUrl);
      if (email) {
        setEmailPreview(email);
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to create invite");
      setIsInviteSubmitting(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!activeLab) return;
    setInviteError(null);
    setCancelingInviteId(inviteId);
    try {
      await cancelLabInvite(activeLab.id, inviteId);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to cancel invite");
    } finally {
      setCancelingInviteId(null);
    }
  };

  const updateMemberRole = async (member: LabMember, role: LabRole) => {
    if (!activeLab || member.uid === activeMember?.uid || !canManageAccounts) return;
    try {
      await updateLabMember(activeLab.id, member.uid, {
        role,
        piUid: role === "researcher" ? member.piUid || piMembers[0]?.uid || null : role === "pi" ? member.uid : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update member role");
    }
  };

  const updateMemberPi = async (member: LabMember, piUid: string) => {
    if (!activeLab || !canManageAccounts) return;
    try {
      await updateLabMember(activeLab.id, member.uid, { piUid: piUid || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update PI assignment");
    }
  };

  const toggleMemberStatus = async (member: LabMember) => {
    if (!activeLab || member.uid === activeMember?.uid || !canManageAccounts) return;
    try {
      await updateLabMember(activeLab.id, member.uid, { status: member.status === "disabled" ? "active" : "disabled" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update member status");
    }
  };

  const openOwnershipTransfer = (member: LabMember) => {
    if (!canManageAccounts || outgoingOwnershipTransfer || member.uid === activeMember?.uid || member.status !== "active" || member.role === "owner") {
      return;
    }
    setOwnershipError(null);
    setOwnershipTarget(member);
    setOwnershipConfirmationEmail("");
  };

  const closeOwnershipTransfer = () => {
    if (isOwnershipSubmitting) return;
    setOwnershipTarget(null);
    setOwnershipConfirmationEmail("");
  };

  const submitOwnershipTransfer = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeLab || !ownershipTarget || !canManageAccounts) return;
    setOwnershipError(null);
    setIsOwnershipSubmitting(true);
    try {
      await initiateLabOwnershipTransfer({
        labId: activeLab.id,
        targetUid: ownershipTarget.uid,
        confirmationEmail: ownershipConfirmationEmail,
      });
      setOwnershipTarget(null);
      setOwnershipConfirmationEmail("");
    } catch (err) {
      setOwnershipError(err instanceof Error ? err.message : "Unable to request ownership transfer");
    } finally {
      setIsOwnershipSubmitting(false);
    }
  };

  const resolveOwnershipTransfer = async (transfer: LabOwnershipTransfer, action: "accept" | "decline" | "cancel") => {
    if (!activeLab) return;
    const prompt = action === "accept"
      ? "Accepting makes you the lab owner and changes the former owner to PI. Continue?"
      : action === "decline"
        ? "Decline this ownership-transfer request? No permissions will change."
        : "Cancel this pending ownership-transfer request? No permissions will change.";
    if (!window.confirm(prompt)) return;

    setOwnershipError(null);
    setOwnershipActionId(transfer.id);
    try {
      if (action === "accept") {
        await acceptLabOwnershipTransfer(activeLab.id, transfer.id);
      } else if (action === "decline") {
        await declineLabOwnershipTransfer(activeLab.id, transfer.id);
      } else {
        await cancelLabOwnershipTransfer(activeLab.id, transfer.id);
      }
    } catch (err) {
      setOwnershipError(err instanceof Error ? err.message : "Unable to update ownership transfer");
    } finally {
      setOwnershipActionId(null);
    }
  };

  const inviteEmailFor = (invite: LabInvite, inviteUrl: string) => {
    if (!activeLab || !user) return;
    const role = roleLabel(invite.role).toLowerCase();
    const subject =
      invite.role === "pi"
        ? `${user.name} invited you to join ${activeLab.name} as a PI on LabOS`
        : `${user.name} invited you to ${activeLab.name} on LabOS`;
    const body = [
      `Hi ${invite.displayName},`,
      "",
      `${user.name} invited you to join ${activeLab.name} as a ${role}.`,
      ...(invite.role === "pi"
        ? ["", "When you accept, LabOS will create your PI group so researchers can be assigned under you."]
        : []),
      "",
      `Accept the invite here: ${inviteUrl}`,
      "",
      "If you were not expecting this invite, you can ignore this email.",
    ].join("\r\n");

    return { to: invite.email, subject, body, inviteUrl };
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <>
      <div className="topbar">
        <h1>Team</h1>
        <div className="topbar-actions">
          <button className="btn-secondary" disabled={!canManageInvites} onClick={() => openInviteModal("researcher")}>
            Invite User
          </button>
          <button className="btn-primary" disabled={!canInvitePrivileged} onClick={() => openInviteModal("pi")}>
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
        {ownershipError && <div className="team-error">{ownershipError}</div>}

        {!isLoading && !error && (
          <>
            {(outgoingOwnershipTransfer || incomingOwnershipTransfer) && (
              <section className="team-section">
                <div className="team-section-header">
                  <h2>Ownership Transfer</h2>
                  <p>Ownership changes only after both people explicitly confirm.</p>
                </div>
                <div className="ownership-transfer-list">
                  {outgoingOwnershipTransfer && (
                    <article className="ownership-transfer-card">
                      <div>
                        <h3>Awaiting {outgoingOwnershipTransfer.targetName}</h3>
                        <p>
                          You remain the owner until they accept. This request expires {formatTransferExpiry(outgoingOwnershipTransfer.expiresAt)}.
                        </p>
                      </div>
                      <button
                        className="invite-cancel-btn"
                        disabled={ownershipActionId === outgoingOwnershipTransfer.id}
                        onClick={() => resolveOwnershipTransfer(outgoingOwnershipTransfer, "cancel")}
                      >
                        {ownershipActionId === outgoingOwnershipTransfer.id ? "Canceling..." : "Cancel transfer"}
                      </button>
                    </article>
                  )}
                  {incomingOwnershipTransfer && (
                    <article className="ownership-transfer-card incoming">
                      <div>
                        <h3>{incomingOwnershipTransfer.initiatedByName} requested an ownership transfer</h3>
                        <p>
                          If you accept, you become the lab owner and {incomingOwnershipTransfer.initiatedByName} remains an active PI. This request expires {formatTransferExpiry(incomingOwnershipTransfer.expiresAt)}.
                        </p>
                      </div>
                      <div className="ownership-transfer-actions">
                        <button
                          className="invite-cancel-btn"
                          disabled={ownershipActionId === incomingOwnershipTransfer.id}
                          onClick={() => resolveOwnershipTransfer(incomingOwnershipTransfer, "decline")}
                        >
                          Decline
                        </button>
                        <button
                          className="btn-primary"
                          disabled={ownershipActionId === incomingOwnershipTransfer.id}
                          onClick={() => resolveOwnershipTransfer(incomingOwnershipTransfer, "accept")}
                        >
                          {ownershipActionId === incomingOwnershipTransfer.id ? "Accepting..." : "Accept ownership"}
                        </button>
                      </div>
                    </article>
                  )}
                </div>
              </section>
            )}

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

                {pendingPiInvites.map((invite) => (
                  <article key={invite.id} className="pi-group-card pending-pi-card">
                    <div className="team-person-row">
                      <div className="team-avatar muted">{initialsForInvite(invite)}</div>
                      <div>
                        <h3>{invite.displayName}</h3>
                        <span>PI invite pending</span>
                      </div>
                    </div>

                    <div className="researcher-list">
                      <div className="researcher-row pending">
                        <span>{invite.email}</span>
                        <small>This PI group will be created after invite acceptance.</small>
                      </div>
                    </div>

                    <small className="invite-email-state">The secure link was shown once when this invite was created.</small>
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
                  <p>Secure links are returned once at creation and are never stored with invite records.</p>
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
                        <small className="invite-email-state">Link shown once at creation. Cancel and issue a new invite to resend.</small>
                      </div>
                      <span className="invite-role-pill">{roleLabel(invite.role)}</span>
                      <span className="invite-meta">{inviteMetaFor(invite, members)}</span>
                      <button className="invite-cancel-btn" disabled={cancelingInviteId === invite.id} onClick={() => handleCancelInvite(invite.id)}>
                        {cancelingInviteId === invite.id ? "Canceling..." : "Cancel"}
                      </button>
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
                      {canManageAccounts && <th>Actions</th>}
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
                        <td>
                          {canManageAccounts && member.uid !== activeMember?.uid ? (
                            <select className="team-inline-select" value={member.role} onChange={(e) => updateMemberRole(member, e.target.value as LabRole)}>
                              {member.role === "external" && <option value="external" disabled>External Collaborator (access disabled)</option>}
                              {MEMBER_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          ) : (
                            roleLabel(member.role)
                          )}
                        </td>
                        <td><span className={`member-status-pill ${member.status}`}>{member.status}</span></td>
                        <td>
                          {canManageAccounts && member.role === "researcher" ? (
                            <select className="team-inline-select" value={member.piUid ?? ""} onChange={(e) => updateMemberPi(member, e.target.value)}>
                              <option value="">Unassigned</option>
                              {piMembers.map((pi) => <option key={pi.uid} value={pi.uid}>{pi.displayName}</option>)}
                            </select>
                          ) : (
                            piNameFor(member.piUid, members)
                          )}
                        </td>
                        {canManageAccounts && (
                          <td>
                            <div className="team-member-actions">
                              <button className="invite-cancel-btn" disabled={member.uid === activeMember?.uid} onClick={() => toggleMemberStatus(member)}>
                                {member.status === "disabled" ? "Reactivate" : "Disable"}
                              </button>
                              {member.uid !== activeMember?.uid
                                && member.status === "active"
                                && member.role !== "owner"
                                && member.role !== "external"
                                && !outgoingOwnershipTransfer && (
                                  <button className="btn-secondary team-transfer-btn" onClick={() => openOwnershipTransfer(member)}>
                                    Transfer ownership
                                  </button>
                                )}
                            </div>
                          </td>
                        )}
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
                <h2>{inviteMode === "pi" ? "Add PI" : "Invite User"}</h2>
                <p>
                  {inviteMode === "pi"
                    ? `Create a PI invite link for ${activeLab?.name}.`
                    : `Add an admin, researcher, or viewer to ${activeLab?.name}.`}
                </p>
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
                placeholder={inviteMode === "pi" ? "Dr. Maya Patel" : "Alex Rivera"}
              />
            </label>

            {inviteMode === "pi" ? (
              <div className="team-fixed-role">
                <span>Role</span>
                <strong>PI</strong>
                <small>A PI group is created automatically after this invite is accepted.</small>
              </div>
            ) : (
              <label className="modal-field">
                <span>Role</span>
                <select value={inviteForm.role} onChange={(e) => updateInviteField("role", e.target.value)}>
                  {INVITE_ROLE_OPTIONS.filter((option) => option.value !== "pi" && (canInvitePrivileged || option.value !== "admin")).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

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
              {inviteMode === "pi"
                ? "This creates a one-time PI invite. The PI must verify the invited email before LabOS adds them as a PI and creates their PI group."
                : "This creates a one-time secure invite. Copy the generated email or link now; it is intentionally not stored after this step."}
            </div>

            <div className="experiment-modal-actions">
              <button type="button" className="btn-secondary" onClick={closeInviteModal}>
                Cancel
              </button>
              <button className="btn-primary" type="submit" disabled={isInviteSubmitting}>
                {isInviteSubmitting ? "Creating..." : inviteMode === "pi" ? "Create PI Invite" : "Create Invite"}
              </button>
            </div>
          </form>
        </div>
      )}

      {ownershipTarget && (
        <div className="modal-backdrop" onMouseDown={closeOwnershipTransfer}>
          <form className="team-invite-modal" onSubmit={submitOwnershipTransfer} onMouseDown={(event) => event.stopPropagation()}>
            <div className="experiment-modal-header">
              <div>
                <h2>Transfer Lab Ownership</h2>
                <p>Request a two-person ownership handoff to {ownershipTarget.displayName}.</p>
              </div>
              <button type="button" className="modal-close" onClick={closeOwnershipTransfer} disabled={isOwnershipSubmitting}>
                x
              </button>
            </div>

            {ownershipError && <div className="team-error compact">{ownershipError}</div>}

            <div className="team-invite-note">
              {ownershipTarget.displayName} must separately accept while signed in. Until then, you remain the owner. After acceptance, you retain an active PI role so existing PI groups stay intact.
            </div>

            <label className="modal-field">
              <span>Type {ownershipTarget.email} to confirm</span>
              <input
                type="email"
                value={ownershipConfirmationEmail}
                onChange={(event) => setOwnershipConfirmationEmail(event.target.value)}
                placeholder={ownershipTarget.email}
                autoComplete="off"
                required
              />
            </label>

            <div className="experiment-modal-actions">
              <button type="button" className="btn-secondary" onClick={closeOwnershipTransfer} disabled={isOwnershipSubmitting}>
                Cancel
              </button>
              <button className="btn-primary" type="submit" disabled={isOwnershipSubmitting || ownershipConfirmationEmail.trim().toLowerCase() !== ownershipTarget.email.toLowerCase()}>
                {isOwnershipSubmitting ? "Requesting..." : "Request transfer"}
              </button>
            </div>
          </form>
        </div>
      )}

      {emailPreview && (
        <div className="modal-backdrop" onMouseDown={() => setEmailPreview(null)}>
          <div className="team-invite-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="experiment-modal-header">
              <div>
                <h2>Email Invite</h2>
                <p>Copy or send this one-time secure invite now. It is not retained in the pending-invite list.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setEmailPreview(null)}>
                x
              </button>
            </div>

            <label className="modal-field">
              <span>To</span>
              <input value={emailPreview.to} readOnly />
            </label>
            <label className="modal-field">
              <span>Subject</span>
              <input value={emailPreview.subject} readOnly />
            </label>
            <label className="modal-field">
              <span>Invite Link</span>
              <input value={emailPreview.inviteUrl} readOnly />
            </label>
            <label className="modal-field">
              <span>Email Body</span>
              <textarea value={emailPreview.body} readOnly rows={8} />
            </label>

            <div className="team-invite-note">
              The link is available only in this dialog. Copy it deliberately and send it only to the intended recipient.
            </div>

            <div className="experiment-modal-actions">
              <button type="button" className="btn-secondary" onClick={() => copyText(emailPreview.inviteUrl)}>
                Copy Link
              </button>
              <button type="button" className="btn-primary" onClick={() => copyText(emailPreview.body)}>
                Copy Email Body
              </button>
            </div>
          </div>
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

function initialsForInvite(invite: LabInvite) {
  const parts = invite.displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return invite.email.slice(0, 2).toUpperCase();
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

function inviteMetaFor(invite: LabInvite, members: LabMember[]) {
  if (invite.role === "researcher") return piNameFor(invite.piUid, members);
  if (invite.role === "pi") return "PI group on accept";
  return "Lab-wide";
}

function formatTransferExpiry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "soon";
  if (date.getTime() <= Date.now()) return "now";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
