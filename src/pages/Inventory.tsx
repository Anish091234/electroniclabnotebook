import { StubPage } from "./StubPage";
import { InventoryIcon } from "../components/icons";

export function Inventory() {
  return (
    <StubPage
      title="Inventory"
      description="Track reagents, consumables, and equipment stock levels, with low-stock alerts tied directly to your experiments."
      icon={<InventoryIcon color="#1d4ed8" size={22} />}
    />
  );
}
