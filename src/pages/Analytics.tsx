import { StubPage } from "./StubPage";
import { AnalyticsIcon } from "../components/icons";

export function Analytics() {
  return (
    <StubPage
      title="Analytics"
      description="Lab-wide throughput, protocol success rates, and AI-surfaced trends across all experiments will be visualized here."
      icon={<AnalyticsIcon color="#1d4ed8" size={22} />}
    />
  );
}
