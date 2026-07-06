import { StubPage } from "./StubPage";
import { ProtocolsIcon } from "../components/icons";

export function Protocols() {
  return (
    <StubPage
      title="Protocols"
      description="Reusable, versioned protocol templates for your lab will live here — build once, run across experiments."
      icon={<ProtocolsIcon color="#1d4ed8" size={22} />}
    />
  );
}
