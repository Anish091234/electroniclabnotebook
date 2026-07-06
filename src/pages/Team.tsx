import { StubPage } from "./StubPage";
import { TeamIcon } from "../components/icons";

export function Team() {
  return (
    <StubPage
      title="Team"
      description="Manage collaborators, roles, and permissions across your projects from a single team directory."
      icon={<TeamIcon color="#1d4ed8" size={22} />}
    />
  );
}
