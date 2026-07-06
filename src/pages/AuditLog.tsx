import { StubPage } from "./StubPage";
import { AuditLogIcon } from "../components/icons";

export function AuditLog() {
  return (
    <StubPage
      title="Audit Log"
      description="A compliance-ready, immutable trail of every change across experiments, protocols, and inventory."
      icon={<AuditLogIcon color="#1d4ed8" size={22} />}
    />
  );
}
